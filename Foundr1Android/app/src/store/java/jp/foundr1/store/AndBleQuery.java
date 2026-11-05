package jp.foundr1.store;

import java.nio.charset.StandardCharsets;

/** One serialized command response, bound to its immutable weighing context. */
public final class AndBleQuery {
    public static final long TIMEOUT_MS = 2000;
    public static final byte[] COMMAND = new byte[] { 0x51, 0x0d, 0x0a };
    public static final byte[] CLEAR_TARE_COMMAND = new byte[] { 0x43, 0x54, 0x0d, 0x0a };
    public final String session;
    public final String tareToken;
    public final int epoch;
    public final long requestedElapsed;
    public final boolean clearsTare;
    private final StringBuilder buffer = new StringBuilder();
    private boolean complete;
    public AndBleQuery(String session, int epoch, long requestedElapsed) {
        this(session, epoch, requestedElapsed, "", false);
    }
    public AndBleQuery(String session, int epoch, long requestedElapsed, String tareToken) {
        this(session, epoch, requestedElapsed, tareToken, false);
    }
    private AndBleQuery(String session, int epoch, long requestedElapsed, String tareToken, boolean clearsTare) {
        this.session = session; this.epoch = epoch; this.requestedElapsed = requestedElapsed;
        this.tareToken = tareToken == null ? "" : tareToken; this.clearsTare = clearsTare;
    }
    public static AndBleQuery clearTare(String session, int epoch, long requestedElapsed, String tareToken) {
        if (tareToken == null || tareToken.isEmpty()) throw new IllegalArgumentException("Missing tare context");
        return new AndBleQuery(session, epoch, requestedElapsed, tareToken, true);
    }
    public byte[] command() { return (clearsTare ? CLEAR_TARE_COMMAND : COMMAND).clone(); }
    public boolean expired(long now) { return now < requestedElapsed || now - requestedElapsed >= TIMEOUT_MS; }
    public String offer(byte[] bytes, long now) {
        if (complete || expired(now) || bytes == null) return null;
        if (bytes.length > 512) throw new IllegalArgumentException("BLE frame too large");
        for (int index = 0; index < bytes.length; index++) {
            byte value = bytes[index];
            int c = value & 0xff;
            if (c != 13 && c != 10 && (c < 32 || c > 126)) throw new IllegalArgumentException("Invalid BLE ASCII");
            buffer.append((char)c);
            if (buffer.length() > 256) throw new IllegalArgumentException("BLE frame too large");
            int length = buffer.length();
            if (length >= 2 && buffer.charAt(length - 2) == '\r' && buffer.charAt(length - 1) == '\n') {
                String line = buffer.toString(); buffer.setLength(0);
                if (clearsTare) {
                    // Manufacturer SH-AWP manual 10.5: CT is answered by exactly CT CR LF.
                    // Neither an ATT write completion nor a generic ACK proves cleared tare.
                    if (!line.equals("CT\r\n") || index != bytes.length - 1) throw new IllegalArgumentException("Invalid CT response");
                    complete = true; return line;
                }
                if (!tareToken.isEmpty()) {
                    if (line.getBytes(StandardCharsets.US_ASCII).length != 17 || AndScaleReading.parse(line) == null
                        || index != bytes.length - 1) throw new IllegalArgumentException("Invalid gross weight response");
                    complete = true; return line;
                }
                // Ignore a command echo/ACK. Only an official complete 17-byte weight frame answers Q.
                if (line.startsWith("ST,") || line.startsWith("US,") || line.startsWith("OL,") || line.length() == 17) {
                    if (line.getBytes(StandardCharsets.US_ASCII).length != 17 || AndScaleReading.parse(line) == null) throw new IllegalArgumentException("Invalid A&D weight frame");
                    complete = true; return line;
                }
                if (!line.equals("Q\r\n") && !line.equals("ACK\r\n") && !line.equals("\r\n")) throw new IllegalArgumentException("Unexpected A&D frame");
            }
        }
        return null;
    }
}
