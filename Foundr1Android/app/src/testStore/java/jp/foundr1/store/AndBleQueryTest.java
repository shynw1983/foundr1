package jp.foundr1.store;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndBleQueryTest {
    private byte[] bytes(String value) { return value.getBytes(StandardCharsets.US_ASCII); }
    @Test public void officialCommandAndSeventeenByteFrames() {
        assertArrayEquals(new byte[]{0x51,0x0d,0x0a},AndBleQuery.COMMAND);
        for (String line : new String[]{"ST,+0012.345 kg\r\n","ST,-00001234  g\r\n","OL,+9999.999 kg\r\n"}) {
            assertEquals(17,bytes(line).length);
            assertEquals(line,new AndBleQuery("session-a",3,100).offer(bytes(line),110));
        }
    }
    @Test public void splitFramesKeepTheIssuingSessionAndEpoch() {
        AndBleQuery query=new AndBleQuery("session-a",3,100);
        assertNull(query.offer(bytes("ST,+001"),110));
        assertNull(query.offer(bytes("2.345 kg\r"),120));
        assertEquals("ST,+0012.345 kg\r\n",query.offer(bytes("\n"),130));
        assertEquals("session-a",query.session);assertEquals(3,query.epoch);assertEquals(100,query.requestedElapsed);
    }
    @Test public void echoAndAckDoNotAnswerWeightRequestAndOnlyOneFrameIsAdopted() {
        AndBleQuery query=new AndBleQuery("session-a",3,100);
        assertNull(query.offer(bytes("Q\r\nACK\r\n"),110));
        assertEquals("US,+0012.345 kg\r\n",query.offer(bytes("US,+0012.345 kg\r\nST,+0012.345 kg\r\n"),120));
        assertNull(query.offer(bytes("ST,+0012.345 kg\r\n"),130));
    }
    @Test public void lateRepliesAndClockReversalAreRejected() {
        assertNull(new AndBleQuery("a",1,100).offer(bytes("ST,+0012.345 kg\r\n"),2100));
        assertNull(new AndBleQuery("a",1,100).offer(bytes("ST,+0012.345 kg\r\n"),99));
    }
    @Test public void newRequestCannotInheritPartialOldFrame() {
        AndBleQuery old=new AndBleQuery("a",1,100);assertNull(old.offer(bytes("ST,+001"),110));
        try { new AndBleQuery("b",2,120).offer(bytes("2.345 kg\r\n"),130);fail("orphan fragment accepted"); }catch(IllegalArgumentException expected){}
        AndBleQuery next=new AndBleQuery("b",2,120);
        assertEquals("ST,+0012.345 kg\r\n",next.offer(bytes("ST,+0012.345 kg\r\n"),140));
    }
    @Test public void malformedWeightOrUnboundedFramesFail() {
        for(String line:new String[]{"ST,+NaN kg\r\n","ST,+0012.345 mg\r\n","ST,+0012.345 kg\n\r\n"}) {
            try { new AndBleQuery("a",1,100).offer(bytes(line),110);fail("malformed weight accepted"); }catch(IllegalArgumentException expected){}
        }
        try { new AndBleQuery("a",1,100).offer(new byte[513],110);fail("oversize accepted"); }catch(IllegalArgumentException expected){}
        try { new AndBleQuery("a",1,100).offer(new byte[]{(byte)0xff},110);fail("non ASCII accepted"); }catch(IllegalArgumentException expected){}
    }
    @Test public void clearTareRequiresItsExactFragmentedApplicationResponse() {
        AndBleQuery query=AndBleQuery.clearTare("bowl-a",3,100,"context-a");
        assertArrayEquals(bytes("CT\r\n"),query.command()); assertTrue(query.clearsTare);
        assertEquals("context-a",query.tareToken);
        assertNull(query.offer(bytes("C"),110)); assertNull(query.offer(bytes("T\r"),120));
        assertEquals("CT\r\n",query.offer(bytes("\n"),130));
        assertNull(query.offer(bytes("CT\r\n"),140));
        assertNull(AndBleQuery.clearTare("a",1,100,"proof").offer(bytes("CT\r\n"),2100));
    }
    @Test public void clearTareRejectsGenericAckWeightOtherCommandsAndTrailingData() {
        for(String line:new String[]{"ACK\r\n","T\r\n","Q\r\n","ST,+000300.0  g\r\n","CT\r\nCT\r\n","CT\r\nX"}) {
            try { AndBleQuery.clearTare("a",1,100,"proof").offer(bytes(line),110);fail("unsafe CT reply accepted: "+line); }
            catch(IllegalArgumentException expected){}
        }
    }
    @Test public void grossQueriesRejectControlRepliesAndMultipleFrames() {
        AndBleQuery query=new AndBleQuery("a",1,100,"proof");
        assertArrayEquals(bytes("Q\r\n"),query.command()); assertFalse(query.clearsTare);
        assertEquals("proof",query.tareToken);
        assertEquals("ST,+000300.0  g\r\n",query.offer(bytes("ST,+000300.0  g\r\n"),110));
        for(String line:new String[]{"ACK\r\n","CT\r\n","Q\r\n","ST,+000300.0  g\r\nST,+000300.0  g\r\n"}) {
            try { new AndBleQuery("a",1,100,"proof").offer(bytes(line),110);fail("unsafe gross reply accepted"); }
            catch(IllegalArgumentException expected){}
        }
    }
}
