package sg.hundredacre.grid.scanner

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.InterFontFamily
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
fun BarcodeScannerScreen(
    onScanSuccess: (String) -> Unit,
    modifier: Modifier = Modifier,
    onClose: () -> Unit = {}
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { granted -> hasCameraPermission = granted }
    )

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    if (hasCameraPermission) {
        CameraScannerPreview(
            onScanSuccess = onScanSuccess,
            onClose = onClose,
            modifier = modifier
        )
    } else {
        CameraPermissionContent(
            onRequestPermission = { permissionLauncher.launch(Manifest.permission.CAMERA) },
            onClose = onClose,
            modifier = modifier
        )
    }
}

@Composable
private fun CameraScannerPreview(
    onScanSuccess: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestOnScanSuccess by rememberUpdatedState(onScanSuccess)
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }
    val didScan = remember { AtomicBoolean(false) }
    val previewView = remember {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }

    DisposableEffect(lifecycleOwner) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        val listener = Runnable {
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val analyzer = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also {
                    it.setAnalyzer(cameraExecutor) { imageProxy ->
                        processImageProxy(
                            imageProxy = imageProxy,
                            scanner = scanner,
                            didScan = didScan,
                            onScanSuccess = latestOnScanSuccess
                        )
                    }
                }

            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(
                lifecycleOwner,
                CameraSelector.DEFAULT_BACK_CAMERA,
                preview,
                analyzer
            )
        }
        cameraProviderFuture.addListener(listener, ContextCompat.getMainExecutor(context))

        onDispose {
            cameraProviderFuture.get().unbindAll()
            cameraExecutor.shutdown()
            scanner.close()
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        AndroidView(
            factory = { previewView },
            modifier = Modifier.fillMaxSize()
        )

        ScannerOverlay(modifier = Modifier.fillMaxSize())

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.QrCodeScanner,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = "Scan loyalty code",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 18.sp,
                    color = Color.White
                )
            }
            IconButton(onClick = onClose) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Close scanner",
                    tint = Color.White
                )
            }
        }
    }
}

@OptIn(ExperimentalGetImage::class)
private fun processImageProxy(
    imageProxy: ImageProxy,
    scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    didScan: AtomicBoolean,
    onScanSuccess: (String) -> Unit
) {
    val mediaImage = imageProxy.image
    if (mediaImage == null) {
        imageProxy.close()
        return
    }

    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
    scanner.process(image)
        .addOnSuccessListener { barcodes ->
            val value = barcodes.firstNotNullOfOrNull { it.rawValue }
            if (value != null && didScan.compareAndSet(false, true)) {
                onScanSuccess(value.trim())
            }
        }
        .addOnCompleteListener {
            imageProxy.close()
        }
}

@Composable
private fun ScannerOverlay(modifier: Modifier = Modifier) {
    Box(modifier = modifier) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val scanWidth = size.width * 0.68f
            val scanHeight = scanWidth
            val left = (size.width - scanWidth) / 2f
            val top = (size.height - scanHeight) / 2f
            val cornerLength = 48.dp.toPx()
            val strokeWidth = 4.dp.toPx()

            drawRoundRect(
                color = Color.Black.copy(alpha = 0.36f),
                size = size
            )
            drawRoundRect(
                color = Color.White.copy(alpha = 0.18f),
                topLeft = Offset(left, top),
                size = Size(scanWidth, scanHeight),
                cornerRadius = CornerRadius(18.dp.toPx(), 18.dp.toPx()),
                style = Stroke(width = 1.dp.toPx())
            )
            drawLine(
                color = Color.White,
                start = Offset(left, top + cornerLength),
                end = Offset(left, top),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
            drawLine(
                color = Color.White,
                start = Offset(left, top),
                end = Offset(left + cornerLength, top),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
            drawLine(
                color = Color.White,
                start = Offset(left + scanWidth - cornerLength, top),
                end = Offset(left + scanWidth, top),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
            drawLine(
                color = Color.White,
                start = Offset(left + scanWidth, top),
                end = Offset(left + scanWidth, top + cornerLength),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
            drawLine(
                color = Color.White,
                start = Offset(left, top + scanHeight - cornerLength),
                end = Offset(left, top + scanHeight),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
            drawLine(
                color = Color.White,
                start = Offset(left, top + scanHeight),
                end = Offset(left + cornerLength, top + scanHeight),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
            drawLine(
                color = Color.White,
                start = Offset(left + scanWidth - cornerLength, top + scanHeight),
                end = Offset(left + scanWidth, top + scanHeight),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
            drawLine(
                color = Color.White,
                start = Offset(left + scanWidth, top + scanHeight - cornerLength),
                end = Offset(left + scanWidth, top + scanHeight),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round
            )
        }

        Text(
            text = "Align the code inside the frame",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp,
            color = Color.White,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(Alignment.Center)
                .padding(top = 220.dp)
        )
    }
}

@Composable
private fun CameraPermissionContent(
    onRequestPermission: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(GridBackground)
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        IconButton(
            onClick = onClose,
            modifier = Modifier.align(Alignment.TopEnd)
        ) {
            Icon(
                imageVector = Icons.Default.Close,
                contentDescription = "Close scanner",
                tint = GridPrimary
            )
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .border(1.dp, GridPrimary, RoundedCornerShape(18.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.QrCodeScanner,
                    contentDescription = null,
                    tint = GridPrimary,
                    modifier = Modifier.size(34.dp)
                )
            }
            Spacer(modifier = Modifier.height(18.dp))
            Text(
                text = "Camera permission is required to scan loyalty codes.",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                color = Color.Black,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(18.dp))
            Button(onClick = onRequestPermission) {
                Text("Allow Camera")
            }
        }
    }
}
