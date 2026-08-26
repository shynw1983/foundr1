package jp.foundr1.store;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class InventoryWidgetConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        );
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(28));
        root.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("小组件语言 / ウィジェット言語");
        title.setTextColor(Color.rgb(20, 43, 35));
        title.setTextSize(21);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        root.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)));

        TextView help = new TextView(this);
        help.setText("请选择桌面按钮和快速操作面板的显示语言。\nデスクトップと操作画面の表示言語を選択してください。");
        help.setTextColor(Color.DKGRAY);
        help.setTextSize(14);
        help.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams helpParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(90));
        helpParams.setMargins(0, 0, 0, dp(18));
        root.addView(help, helpParams);

        root.addView(languageButton("日本語", InventoryWidgetProvider.LANGUAGE_JA));
        root.addView(new TextView(this), new LinearLayout.LayoutParams(1, dp(14)));
        root.addView(languageButton("中文", InventoryWidgetProvider.LANGUAGE_ZH));
        setContentView(root);
    }

    private Button languageButton(String label, String language) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(18);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(19, 78, 58));
        background.setCornerRadius(dp(12));
        button.setBackground(background);
        button.setOnClickListener(view -> save(language));
        button.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
        return button;
    }

    private void save(String language) {
        InventoryWidgetProvider.saveLanguage(this, widgetId, language);
        InventoryWidgetProvider.refreshWidget(this, widgetId);
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
