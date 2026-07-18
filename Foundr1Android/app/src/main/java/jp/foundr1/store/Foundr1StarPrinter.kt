package jp.foundr1.store

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.starmicronics.stario10.InterfaceType
import com.starmicronics.stario10.StarConnectionSettings
import com.starmicronics.stario10.StarPrinter
import com.starmicronics.stario10.starxpandcommand.DocumentBuilder
import com.starmicronics.stario10.starxpandcommand.DisplayBuilder
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
    @Synchronized
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
                val command = createCommand(bitmap, cutPaper, openCashDrawer)
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
                        sendCommandWithIdentifier(
                            context,
                            interfaceType,
                            candidateIdentifier,
                            command,
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

    @JvmStatic
    @Synchronized
    fun display(
        context: Context,
        connectionType: String,
        identifier: String,
        line1: String,
        line2: String,
    ) {
        runBlocking {
            withContext(Dispatchers.IO) {
                val interfaceType = toInterfaceType(connectionType)
                val command = createDisplayCommand(line1, line2)
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
                        sendCommandWithIdentifier(context, interfaceType, candidateIdentifier, command)
                        return@withContext
                    } catch (error: Throwable) {
                        lastError = error
                        Log.w(TAG, "Star display failed via $interfaceType ($candidateIdentifier)", error)
                    }
                }

                throw lastError ?: IllegalStateException("Star customer display connection failed.")
            }
        }
    }

    private suspend fun sendCommandWithIdentifier(
        context: Context,
        interfaceType: InterfaceType,
        identifier: String,
        command: String,
    ) {
        val settings = StarConnectionSettings(interfaceType, identifier)
        val printer = StarPrinter(settings, context)
        var opened = false
        var primaryError: Throwable? = null
        try {
            printer.openAsync().await()
            opened = true
            printer.printAsync(command).await()
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

    private fun createDisplayCommand(line1: String, line2: String): String {
        val display = DisplayBuilder()
            .actionClearAll()
            .actionSetBackLightState(true)
            .actionShowText("${line1.replace("\n", " ")}\n${line2.replace("\n", " ")}")

        return StarXpandCommandBuilder()
            .addDocument(DocumentBuilder().addDisplay(display))
            .getCommands()
    }
}
