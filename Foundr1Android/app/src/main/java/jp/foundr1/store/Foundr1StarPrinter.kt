package jp.foundr1.store

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.starmicronics.stario10.InterfaceType
import com.starmicronics.stario10.StarConnectionSettings
import com.starmicronics.stario10.StarPrinter
import com.starmicronics.stario10.starxpandcommand.DocumentBuilder
import com.starmicronics.stario10.starxpandcommand.DrawerBuilder
import com.starmicronics.stario10.starxpandcommand.PrinterBuilder
import com.starmicronics.stario10.starxpandcommand.StarXpandCommandBuilder
import com.starmicronics.stario10.starxpandcommand.drawer.OpenParameter
import com.starmicronics.stario10.starxpandcommand.printer.CutType
import com.starmicronics.stario10.starxpandcommand.printer.ImageParameter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.future.await
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

object Foundr1StarPrinter {
    private const val TAG = "Foundr1StarPrinter"

    @JvmStatic
    fun print(
        context: Context,
        connectionType: String,
        identifier: String,
        bitmap: Bitmap,
        cutPaper: Boolean,
        openCashDrawer: Boolean,
    ) {
        runBlocking {
            withContext(Dispatchers.IO) {
                val interfaceType = toInterfaceType(connectionType)
                val requestedIdentifier = identifier.ifBlank { StarConnectionSettings.FIRST_FOUND_DEVICE }
                val identifiers = buildList {
                    add(requestedIdentifier)
                    if (
                        interfaceType == InterfaceType.Bluetooth &&
                        requestedIdentifier != StarConnectionSettings.FIRST_FOUND_DEVICE
                    ) {
                        add(StarConnectionSettings.FIRST_FOUND_DEVICE)
                    }
                }

                var lastError: Throwable? = null
                for (candidateIdentifier in identifiers) {
                    try {
                        printWithIdentifier(
                            context,
                            interfaceType,
                            candidateIdentifier,
                            bitmap,
                            cutPaper,
                            openCashDrawer,
                        )
                        return@withContext
                    } catch (error: Throwable) {
                        lastError = error
                        Log.w(TAG, "Star print failed via $interfaceType ($candidateIdentifier)", error)
                    }
                }

                throw lastError ?: IllegalStateException("Star printer connection failed.")
            }
        }
    }

    private suspend fun printWithIdentifier(
        context: Context,
        interfaceType: InterfaceType,
        identifier: String,
        bitmap: Bitmap,
        cutPaper: Boolean,
        openCashDrawer: Boolean,
    ) {
        val settings = StarConnectionSettings(interfaceType, identifier)
        val printer = StarPrinter(settings, context)
        var opened = false
        var primaryError: Throwable? = null
        try {
            printer.openAsync().await()
            opened = true
            printer.printAsync(createCommand(bitmap, cutPaper, openCashDrawer)).await()
        } catch (error: Throwable) {
            primaryError = error
            val sdkErrors = printer.errorDetail.autoSwitchInterfaceOpenErrors.orEmpty()
                .entries
                .joinToString { (type, sdkError) ->
                    "$type=${sdkError?.errorCode ?: "Unknown"}:${sdkError?.message.orEmpty()}"
                }
            val detail = listOf(
                error::class.java.simpleName,
                error.message,
                sdkErrors.takeIf { it.isNotBlank() },
            ).filterNotNull().joinToString(" / ")
            throw IllegalStateException("Star printer connection failed: $detail", error)
        } finally {
            if (opened) {
                try {
                    printer.closeAsync().await()
                } catch (closeError: Throwable) {
                    if (primaryError != null) {
                        primaryError.addSuppressed(closeError)
                    } else {
                        throw closeError
                    }
                }
            }
        }
    }

    private fun toInterfaceType(connectionType: String): InterfaceType {
        return when (connectionType) {
            "bluetooth" -> InterfaceType.Bluetooth
            "bluetooth_le" -> InterfaceType.BluetoothLE
            "usb" -> InterfaceType.Usb
            else -> InterfaceType.Lan
        }
    }

    private fun createCommand(bitmap: Bitmap, cutPaper: Boolean, openCashDrawer: Boolean): String {
        val document = DocumentBuilder()
        if (openCashDrawer) {
            document.addDrawer(DrawerBuilder().actionOpen(OpenParameter()))
        }

        val printer = PrinterBuilder()
            .actionPrintImage(ImageParameter(bitmap, bitmap.width))
            .actionFeedLine(4)
        if (cutPaper) {
            printer.actionCut(CutType.Partial)
        }
        document.addPrinter(printer)

        return StarXpandCommandBuilder()
            .addDocument(document)
            .getCommands()
    }
}
