package jp.foundr1.store;
import java.util.regex.*;
/** Protocol parser only. Manufacturer GATT specifications are required before connecting. */
public final class AndScaleReading {
    public final double grams; public final boolean stable,overload;
    private AndScaleReading(double grams,boolean stable,boolean overload){this.grams=grams;this.stable=stable;this.overload=overload;}
    private static final Pattern LINE=Pattern.compile("^(ST|US|OL),([+-]\\d+(?:\\.\\d+)?)\\s*(kg|g)$");
    public static AndScaleReading parse(String text){
        if(text==null)return null;Matcher m=LINE.matcher(text.trim());if(!m.matches())return null;
        double value=Double.parseDouble(m.group(2))*("kg".equals(m.group(3))?1000:1);
        if(Double.isInfinite(value)||Double.isNaN(value))return null;
        return new AndScaleReading(value,"ST".equals(m.group(1)),"OL".equals(m.group(1)));
    }
}
