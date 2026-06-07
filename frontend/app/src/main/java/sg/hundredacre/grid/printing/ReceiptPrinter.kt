package sg.hundredacre.grid.printing

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.RemoteException
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import woyou.aidlservice.jiuiv5.ICallback
import woyou.aidlservice.jiuiv5.IWoyouService
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages connection to Sunmi's built-in thermal printer via AIDL.
 * Uses the woyou.aidlservice.jiuiv5 package common on Sunmi T series devices.
 */
@Singleton
class ReceiptPrinter @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "ReceiptPrinter"
        private const val SUNMI_SERVICE_PACKAGE = "woyou.aidlservice.jiuiv5"
        private const val SUNMI_SERVICE_CLASS = "$SUNMI_SERVICE_PACKAGE.IWoyouService"
        private const val SUNMI_ACTION = "$SUNMI_SERVICE_PACKAGE.IWoyouService"

        // Printer status constants from Sunmi SDK
        const val STATUS_OK = 1
        const val STATUS_PAPER_OUT = 2
        const val STATUS_COVER_OPEN = 3
        const val STATUS_BUSY = 4
        const val STATUS_ERROR = 5
        const val STATUS_PAPER_NEAR_END = 6
    }

    private var woyouService: IWoyouService? = null
    private var bound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            woyouService = IWoyouService.Stub.asInterface(service)
            Log.i(TAG, "Connected to Sunmi printer service")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            woyouService = null
            bound = false
            Log.w(TAG, "Disconnected from Sunmi printer service")
        }
    }

    /**
     * Connect to the Sunmi built-in printer service.
     * Returns true if the service binding was initiated successfully.
     */
    fun connect(): Boolean {
        if (bound) return true

        return try {
            val intent = Intent()
            intent.`package` = SUNMI_SERVICE_PACKAGE
            intent.action = SUNMI_ACTION

            val success = context.bindService(
                intent,
                serviceConnection,
                Context.BIND_AUTO_CREATE
            )
            bound = success
            if (!success) {
                Log.w(TAG, "Failed to bind to Sunmi printer service - not a Sunmi device?")
            }
            success
        } catch (e: Exception) {
            Log.e(TAG, "Error connecting to Sunmi printer service", e)
            false
        }
    }

    /**
     * Disconnect from the Sunmi printer service.
     */
    fun disconnect() {
        if (bound) {
            try {
                context.unbindService(serviceConnection)
            } catch (e: Exception) {
                Log.e(TAG, "Error disconnecting from Sunmi printer service", e)
            }
            woyouService = null
            bound = false
        }
    }

    /**
     * Check if the printer service is currently connected.
     */
    fun isConnected(): Boolean = bound && woyouService != null

    /**
     * Print a complete receipt using the Sunmi print service.
     * Returns true if the print job was sent successfully.
     */
    fun printReceipt(receipt: ReceiptData): Boolean {
        if (!isConnected() && !connect()) {
            Log.w(TAG, "Cannot print: printer service not available")
            return false
        }

        return try {
            val bytes = EscPosFormatter.formatReceipt(receipt)
            sendRawData(bytes)
        } catch (e: Exception) {
            Log.e(TAG, "Error printing receipt", e)
            false
        }
    }

    /**
     * Print a test receipt to verify printer functionality.
     * Returns true if the print job was sent successfully.
     */
    fun printTestReceipt(): Boolean {
        if (!isConnected() && !connect()) {
            Log.w(TAG, "Cannot print test: printer service not available")
            return false
        }

        return try {
            val bytes = EscPosFormatter.formatTestReceipt()
            sendRawData(bytes)
        } catch (e: Exception) {
            Log.e(TAG, "Error printing test receipt", e)
            false
        }
    }

    /**
     * Send raw ESC/POS byte data to the Sunmi printer.
     */
    private fun sendRawData(data: ByteArray): Boolean {
        val service = woyouService ?: return false

        return try {
            service.sendRAWData(data, object : ICallback.Stub() {
                override fun onRunResult(isSuccess: Boolean) {
                    Log.i(TAG, "Print result: success=$isSuccess")
                }

                override fun onReturnString(result: String) {
                    Log.i(TAG, "Print return: $result")
                }

                override fun onRaiseException(code: Int, msg: String) {
                    Log.e(TAG, "Print exception: code=$code, msg=$msg")
                }

                override fun onPrintResult(code: Int, msg: String) {
                    Log.i(TAG, "Print result: code=$code, msg=$msg")
                }
            })
            true
        } catch (e: RemoteException) {
            Log.e(TAG, "RemoteException sending print data", e)
            false
        } catch (e: Exception) {
            Log.e(TAG, "Error sending print data", e)
            false
        }
    }

    /**
     * Check printer status. Returns one of the STATUS_* constants.
     * Returns STATUS_ERROR (-1) if not connected.
     */
    fun getPrinterStatus(): Int {
        val service = woyouService ?: return STATUS_ERROR
        return try {
            when (service.updatePrinterState()) {
                0 -> STATUS_OK
                1 -> STATUS_PAPER_NEAR_END
                2 -> STATUS_PAPER_OUT
                3 -> STATUS_COVER_OPEN
                4 -> STATUS_ERROR
                else -> STATUS_ERROR
            }
        } catch (e: RemoteException) {
            Log.e(TAG, "Error getting printer status", e)
            STATUS_ERROR
        }
    }
}