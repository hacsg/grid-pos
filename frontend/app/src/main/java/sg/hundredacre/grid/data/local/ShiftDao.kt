package sg.hundredacre.grid.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import sg.hundredacre.grid.data.models.ShiftRecord

@Dao
interface ShiftDao {

    @Query("SELECT * FROM shift_records ORDER BY clockIn DESC")
    fun getAllShifts(): Flow<List<ShiftRecord>>

    @Query("SELECT * FROM shift_records WHERE shiftId = :shiftId")
    suspend fun getShiftById(shiftId: String): ShiftRecord?

    @Query("SELECT * FROM shift_records WHERE clockOut IS NULL LIMIT 1")
    suspend fun getActiveShift(): ShiftRecord?

    @Query("SELECT * FROM shift_records WHERE clockOut IS NULL LIMIT 1")
    fun getActiveShiftFlow(): Flow<ShiftRecord?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(shift: ShiftRecord)

    @Query("DELETE FROM shift_records")
    suspend fun clearAll()
}