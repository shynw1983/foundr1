package jp.foundr1.store

import android.content.Context
import android.graphics.Bitmap
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
                val settings = StarConnectionSettings(toInterfaceType(connectionType), identifier)
                val printer = StarPrinter(settings, context)
                try {
                    printer.openAsync().await()
                    printer.printAsync(createCommand(bitmap, cutPaper, openCashDrawer)).await()
                } finally {
                    printer.closeAsync().await()
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
