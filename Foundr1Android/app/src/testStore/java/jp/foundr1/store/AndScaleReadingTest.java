package jp.foundr1.store;
import org.junit.Test;
import static org.junit.Assert.*;
public class AndScaleReadingTest {
 @Test public void standardFramesPreserveUnitsAndStatus(){
  AndScaleReading stable=AndScaleReading.parse("ST,+000300.0  g\r\n");
  assertNotNull(stable);assertEquals(300,stable.grams,0.00001);assertTrue(stable.stable);assertFalse(stable.overload);
  AndScaleReading unstable=AndScaleReading.parse("US,+0000.300 kg");assertEquals(300,unstable.grams,0.00001);assertFalse(unstable.stable);
  assertTrue(AndScaleReading.parse("OL,+9999.999 kg").overload);
 }
 @Test public void malformedOrNonWeightFramesAreRejected(){
  for(String text:new String[]{"300","ST,NaN g","ST,+123 PC","ST,+123g;ST,+999g","ST,+123 mg"})assertNull(AndScaleReading.parse(text));
  assertNull(AndScaleReading.parse(null));
 }
}
