"""Print template management routes."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.outlet import Outlet
from app.models.print_template import PrintTemplate
from app.models.staff import Staff, StaffRole
from app.schemas.print_template import PrintTemplateCreate, PrintTemplatePreviewRequest, PrintTemplatePreviewResponse, PrintTemplateRead, PrintTemplateSeedRequest, PrintTemplateUpdate
from app.services.print_renderer import default_template_config, render_document, sample_order_data, validate_template_config
from app.utils.auth import get_current_staff, require_role

router = APIRouter(prefix="/print-templates", tags=["print-templates"])


def _ensure_can_manage_scope(staff: Staff, outlet_id: UUID | None) -> None:
    if staff.role == StaffRole.admin:
        return
    if outlet_id is None or outlet_id != staff.outlet_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot manage templates for this scope")


async def _ensure_outlet_exists(db: AsyncSession, outlet_id: UUID | None) -> None:
    if outlet_id is None:
        return
    outlet = await db.get(Outlet, outlet_id)
    if outlet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found")


async def _get_template_or_404(db: AsyncSession, template_id: UUID) -> PrintTemplate:
    template = await db.get(PrintTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print template not found")
    return template


async def _ensure_name_available(
    db: AsyncSession,
    *,
    outlet_id: UUID | None,
    document_type: str,
    name: str,
    exclude_id: UUID | None = None,
) -> None:
    statement = select(PrintTemplate.id).where(
        PrintTemplate.outlet_id == outlet_id,
        PrintTemplate.document_type == document_type,
        PrintTemplate.name == name,
    )
    if exclude_id is not None:
        statement = statement.where(PrintTemplate.id != exclude_id)
    if await db.scalar(statement) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A template with this name already exists")


async def _deactivate_scope(db: AsyncSession, *, outlet_id: UUID | None, document_type: str, keep_id: UUID | None = None) -> None:
    result = await db.execute(
        select(PrintTemplate).where(
            PrintTemplate.outlet_id == outlet_id,
            PrintTemplate.document_type == document_type,
            PrintTemplate.is_active.is_(True),
        )
    )
    for template in result.scalars().all():
        if keep_id is not None and template.id == keep_id:
            continue
        template.is_active = False


def _fallback_template(document_type: str, outlet_id: UUID | None = None) -> PrintTemplateRead:
    now = datetime.now(timezone.utc)
    return PrintTemplateRead(
        id=UUID("00000000-0000-0000-0000-000000000000"),
        outlet_id=outlet_id,
        document_type=document_type,
        name="Default Receipt" if document_type == "receipt" else "Default Kitchen Chit",
        is_active=True,
        config=default_template_config(document_type),
        created_at=now,
        updated_at=now,
    )


@router.get("", response_model=list[PrintTemplateRead])
async def list_print_templates(
    outlet_id: UUID | None = Query(default=None),
    document_type: str | None = Query(default=None, pattern="^(receipt|kitchen_chit)$"),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager, StaffRole.supervisor)),
) -> list[PrintTemplate]:
    """List outlet templates and global fallbacks."""
    statement = select(PrintTemplate)
    if current_staff.role != StaffRole.admin:
        if outlet_id is not None and outlet_id != current_staff.outlet_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot view another outlet's templates")
        outlet_id = current_staff.outlet_id
    if outlet_id is not None:
        statement = statement.where(or_(PrintTemplate.outlet_id == outlet_id, PrintTemplate.outlet_id.is_(None)))
    if document_type is not None:
        statement = statement.where(PrintTemplate.document_type == document_type)
    statement = statement.order_by(PrintTemplate.document_type, PrintTemplate.outlet_id.is_(None), PrintTemplate.name)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/active", response_model=PrintTemplateRead)
async def get_active_print_template(
    outlet_id: UUID | None = Query(default=None),
    document_type: str = Query(pattern="^(receipt|kitchen_chit)$"),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> PrintTemplateRead:
    """Return the active outlet template, then global fallback, then hardcoded default."""
    if outlet_id is not None:
        result = await db.execute(
            select(PrintTemplate).where(
                PrintTemplate.outlet_id == outlet_id,
                PrintTemplate.document_type == document_type,
                PrintTemplate.is_active.is_(True),
            )
        )
        outlet_template = result.scalar_one_or_none()
        if outlet_template is not None:
            return outlet_template

    result = await db.execute(
        select(PrintTemplate).where(
            PrintTemplate.outlet_id.is_(None),
            PrintTemplate.document_type == document_type,
            PrintTemplate.is_active.is_(True),
        )
    )
    global_template = result.scalar_one_or_none()
    if global_template is not None:
        return global_template
    return _fallback_template(document_type, outlet_id)


@router.post("", response_model=PrintTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_print_template(
    payload: PrintTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager, StaffRole.supervisor)),
) -> PrintTemplate:
    """Create a print template."""
    _ensure_can_manage_scope(current_staff, payload.outlet_id)
    await _ensure_outlet_exists(db, payload.outlet_id)
    await _ensure_name_available(
        db,
        outlet_id=payload.outlet_id,
        document_type=payload.document_type,
        name=payload.name,
    )
    try:
        validate_template_config(payload.config, payload.document_type)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    template = PrintTemplate(**payload.model_dump())
    if template.is_active:
        await _deactivate_scope(db, outlet_id=template.outlet_id, document_type=template.document_type)
    db.add(template)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Print template already exists") from exc
    await db.refresh(template)
    return template


@router.put("/{template_id}", response_model=PrintTemplateRead)
async def update_print_template(
    template_id: UUID,
    payload: PrintTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager, StaffRole.supervisor)),
) -> PrintTemplate:
    """Update a print template."""
    template = await _get_template_or_404(db, template_id)
    _ensure_can_manage_scope(current_staff, template.outlet_id)
    data = payload.model_dump(exclude_unset=True)
    if "outlet_id" in data:
        await _ensure_outlet_exists(db, data["outlet_id"])
    target_document_type = data.get("document_type", template.document_type)
    if "config" in data:
        try:
            validate_template_config(data["config"], target_document_type)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    elif target_document_type != template.document_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="config is required when changing document_type",
        )
    target_outlet_id = data.get("outlet_id", template.outlet_id)
    _ensure_can_manage_scope(current_staff, target_outlet_id)
    target_name = data.get("name", template.name)
    await _ensure_name_available(
        db,
        outlet_id=target_outlet_id,
        document_type=target_document_type,
        name=target_name,
        exclude_id=template.id,
    )
    if data.get("is_active", template.is_active):
        await _deactivate_scope(db, outlet_id=target_outlet_id, document_type=target_document_type, keep_id=template.id)
    for field, value in data.items():
        setattr(template, field, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Print template already exists") from exc
    await db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_print_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager, StaffRole.supervisor)),
) -> Response:
    """Delete a print template."""
    template = await _get_template_or_404(db, template_id)
    _ensure_can_manage_scope(current_staff, template.outlet_id)
    await db.delete(template)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{template_id}/activate", response_model=PrintTemplateRead)
async def activate_print_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager, StaffRole.supervisor)),
) -> PrintTemplate:
    """Activate a template within its scope."""
    template = await _get_template_or_404(db, template_id)
    _ensure_can_manage_scope(current_staff, template.outlet_id)
    await _deactivate_scope(db, outlet_id=template.outlet_id, document_type=template.document_type, keep_id=template.id)
    template.is_active = True
    await db.commit()
    await db.refresh(template)
    return template


@router.api_route("/{template_id}/preview", methods=["GET", "POST"], response_model=PrintTemplatePreviewResponse)
async def preview_print_template(
    template_id: UUID,
    payload: PrintTemplatePreviewRequest | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager, StaffRole.supervisor)),
) -> PrintTemplatePreviewResponse:
    """Render preview text for a stored template."""
    template = await _get_template_or_404(db, template_id)
    if current_staff.role != StaffRole.admin and template.outlet_id not in (None, current_staff.outlet_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot preview another outlet's template")
    order_data = payload.order_data if payload and payload.order_data else sample_order_data(template.document_type)
    return PrintTemplatePreviewResponse(text=render_document(template.config, order_data))


@router.post("/seed", response_model=list[PrintTemplateRead])
async def seed_print_templates(
    payload: PrintTemplateSeedRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin)),
) -> list[PrintTemplate]:
    """Create default receipt and chit templates for an outlet or globally."""
    await _ensure_outlet_exists(db, payload.outlet_id)
    created: list[PrintTemplate] = []
    for document_type, name in (("receipt", "Default Receipt"), ("kitchen_chit", "Default Kitchen Chit")):
        result = await db.execute(
            select(PrintTemplate).where(
                PrintTemplate.outlet_id == payload.outlet_id,
                PrintTemplate.document_type == document_type,
                PrintTemplate.name == name,
            )
        )
        template = result.scalar_one_or_none()
        if template is None:
            template = PrintTemplate(
                id=uuid4(),
                outlet_id=payload.outlet_id,
                document_type=document_type,
                name=name,
                is_active=True,
                config=default_template_config(document_type),
            )
            await _deactivate_scope(db, outlet_id=payload.outlet_id, document_type=document_type)
            db.add(template)
        else:
            await _deactivate_scope(db, outlet_id=payload.outlet_id, document_type=document_type, keep_id=template.id)
            template.is_active = True
            template.config = default_template_config(document_type)
        created.append(template)
    await db.commit()
    for template in created:
        await db.refresh(template)
    return created
