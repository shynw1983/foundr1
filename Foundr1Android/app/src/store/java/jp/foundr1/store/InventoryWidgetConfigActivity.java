package jp.foundr1.store;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class InventoryWidgetConfigActivity extends Activity {
    private static final class Choice {
        final String id;
        final String name;

        Choice(String id, String name) {
            this.id = id == null ? "" : id.trim();
            this.name = name == null ? "" : name.trim();
        }

        @Override public String toString() { return name; }
    }

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private Spinner languageSpinner;
    private Spinner storeSpinner;
    private Spinner brandSpinner;
    private TextView scopeSummary;
    private TextView status;
    private ProgressBar loading;
    private Button saveButton;
    private final List<Choice> stores = new ArrayList<>();
    private final List<Choice> brands = new ArrayList<>();
    private String savedStoreId = "";
    private String savedBrandId = "";
    private int brandLoadSequence = 0;

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
        savedStoreId = InventoryWidgetProvider.storeId(this, widgetId);
        savedBrandId = InventoryWidgetProvider.brandId(this, widgetId);
        setContentView(buildContent());
        loadStores();
    }

    private View buildContent() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(24), dp(24), dp(28));
        root.setBackgroundColor(Color.WHITE);
        scroll.addView(root, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("小组件设置 / ウィジェット設定");
        title.setTextColor(Color.rgb(20, 43, 35));
        title.setTextSize(21);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));

        TextView help = new TextView(this);
        help.setText("请选择这个桌面入口控制的语言、门店和品牌。\nこのウィジェットが操作する言語・店舗・ブランドを選択してください。");
        help.setTextColor(Color.DKGRAY);
        help.setTextSize(14);
        help.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams helpParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        helpParams.setMargins(0, 0, 0, dp(18));
        root.addView(help, helpParams);

        languageSpinner = addField(root, "1  言語 / 语言");
        ArrayAdapter<Choice> languageAdapter = adapter(listOf(
            new Choice(InventoryWidgetProvider.LANGUAGE_JA, "日本語"),
            new Choice(InventoryWidgetProvider.LANGUAGE_ZH, "中文")
        ));
        languageSpinner.setAdapter(languageAdapter);
        languageSpinner.setSelection(InventoryWidgetProvider.LANGUAGE_ZH.equals(
            InventoryWidgetProvider.language(this, widgetId)
        ) ? 1 : 0);

        storeSpinner = addField(root, "2  店舗 / 门店");
        brandSpinner = addField(root, "3  ブランド / 品牌");
        storeSpinner.setEnabled(false);
        brandSpinner.setEnabled(false);

        scopeSummary = new TextView(this);
        scopeSummary.setText("—");
        scopeSummary.setTextColor(Color.rgb(19, 78, 58));
        scopeSummary.setTextSize(16);
        scopeSummary.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        scopeSummary.setGravity(Gravity.CENTER_VERTICAL);
        scopeSummary.setPadding(dp(14), dp(10), dp(14), dp(10));
        scopeSummary.setBackground(rounded(Color.rgb(236, 244, 240), 12));
        LinearLayout.LayoutParams scopeParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58));
        scopeParams.setMargins(0, dp(8), 0, dp(10));
        root.addView(scopeSummary, scopeParams);

        status = new TextView(this);
        status.setTextColor(Color.GRAY);
        status.setTextSize(13);
        status.setGravity(Gravity.CENTER_VERTICAL);
        root.addView(status, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)));

        loading = new ProgressBar(this);
        LinearLayout.LayoutParams loadingParams = new LinearLayout.LayoutParams(dp(34), dp(34));
        loadingParams.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(loading, loadingParams);

        saveButton = new Button(this);
        saveButton.setText("保存并添加 / 保存して追加");
        saveButton.setTextColor(Color.WHITE);
        saveButton.setTextSize(16);
        saveButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        saveButton.setBackground(rounded(Color.rgb(19, 78, 58), 12));
        saveButton.setEnabled(false);
        saveButton.setAlpha(0.45f);
        saveButton.setOnClickListener(view -> save());
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        saveParams.setMargins(0, dp(8), 0, 0);
        root.addView(saveButton, saveParams);

        languageSpinner.setOnItemSelectedListener(simpleSelection(this::updateScopeSummary));
        storeSpinner.setOnItemSelectedListener(simpleSelection(() -> {
            Choice store = selected(storeSpinner, stores);
            updateScopeSummary();
            if (store != null && !store.id.isEmpty()) loadBrands(store.id);
            else clearBrands();
        }));
        brandSpinner.setOnItemSelectedListener(simpleSelection(this::updateScopeSummary));
        return scroll;
    }

    private Spinner addField(LinearLayout root, String labelText) {
        TextView label = new TextView(this);
        label.setText(labelText);
        label.setTextColor(Color.rgb(35, 62, 52));
        label.setTextSize(14);
        label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34));
        labelParams.setMargins(0, dp(4), 0, 0);
        root.addView(label, labelParams);
        Spinner spinner = new Spinner(this, Spinner.MODE_DROPDOWN);
        spinner.setPadding(dp(10), 0, dp(8), 0);
        GradientDrawable background = rounded(Color.rgb(245, 247, 246), 10);
        background.setStroke(dp(1), Color.rgb(210, 219, 215));
        spinner.setBackground(background);
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        spinnerParams.setMargins(0, 0, 0, dp(8));
        root.addView(spinner, spinnerParams);
        return spinner;
    }

    private void loadStores() {
        loading.setVisibility(View.VISIBLE);
        status.setText("门店读取中… / 店舗を読み込み中…");
        new Thread(() -> {
            try {
                JSONObject body = InventoryApiClient.loadConfiguration(savedStoreId);
                runOnUiThread(() -> showStores(body));
            } catch (Exception error) {
                runOnUiThread(() -> showError(error));
            }
        }, "foundr1-widget-config-stores").start();
    }

    private void showStores(JSONObject body) {
        stores.clear();
        stores.add(new Choice("", "请选择门店 / 店舗を選択"));
        JSONObject access = body.optJSONObject("access");
        JSONArray rows = access == null ? null : access.optJSONArray("stores");
        if (rows != null) {
            for (int index = 0; index < rows.length(); index += 1) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                String id = row.optString("id");
                String name = row.optString("name");
                if (!id.isEmpty() && !name.isEmpty()) stores.add(new Choice(id, name));
            }
        }
        storeSpinner.setAdapter(adapter(stores));
        storeSpinner.setEnabled(stores.size() > 1);
        int selection = indexOf(stores, savedStoreId);
        storeSpinner.setSelection(selection >= 0 ? selection : 0);
        loading.setVisibility(View.GONE);
        if (stores.size() <= 1) {
            status.setText("没有可操作门店。请先在 Foundr1 Store 登录有门店权限的账号。\n操作可能な店舗がありません。店舗権限のあるアカウントでログインしてください。");
        } else {
            status.setText("请选择门店。/ 店舗を選択してください。");
        }
        updateScopeSummary();
    }

    private void loadBrands(String storeId) {
        int sequence = ++brandLoadSequence;
        loading.setVisibility(View.VISIBLE);
        brandSpinner.setEnabled(false);
        status.setText("品牌读取中… / ブランドを読み込み中…");
        new Thread(() -> {
            try {
                JSONObject body = InventoryApiClient.loadConfiguration(storeId);
                runOnUiThread(() -> {
                    if (sequence == brandLoadSequence) showBrands(body);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (sequence == brandLoadSequence) showError(error);
                });
            }
        }, "foundr1-widget-config-brands").start();
    }

    private void showBrands(JSONObject body) {
        brands.clear();
        brands.add(new Choice("", "全ブランド / 全部品牌"));
        JSONArray rows = body.optJSONArray("brands");
        if (rows != null) {
            for (int index = 0; index < rows.length(); index += 1) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                String id = row.optString("id");
                String name = row.optString("name");
                if (!id.isEmpty() && !name.isEmpty()) brands.add(new Choice(id, name));
            }
        }
        brandSpinner.setAdapter(adapter(brands));
        brandSpinner.setEnabled(true);
        int selection = indexOf(brands, savedBrandId);
        brandSpinner.setSelection(selection >= 0 ? selection : 0);
        savedBrandId = "";
        loading.setVisibility(View.GONE);
        status.setText("控制范围确认后保存。/ 操作範囲を確認して保存してください。");
        updateScopeSummary();
    }

    private void clearBrands() {
        brandLoadSequence += 1;
        brands.clear();
        brands.add(new Choice("", "全ブランド / 全部品牌"));
        brandSpinner.setAdapter(adapter(brands));
        brandSpinner.setEnabled(false);
        updateScopeSummary();
    }

    private void showError(Exception error) {
        loading.setVisibility(View.GONE);
        storeSpinner.setEnabled(!stores.isEmpty());
        status.setText(error.getMessage() == null
            ? "读取失败，请先打开 Foundr1 Store 登录。\n読み込みに失敗しました。Foundr1 Storeでログインしてください。"
            : error.getMessage());
        updateScopeSummary();
    }

    private void updateScopeSummary() {
        Choice store = selected(storeSpinner, stores);
        Choice brand = selected(brandSpinner, brands);
        boolean chinese = languageSpinner != null && languageSpinner.getSelectedItemPosition() == 1;
        String allBrands = chinese ? "全部品牌" : "全ブランド";
        String storeLabel = store == null || store.id.isEmpty() ? (chinese ? "未选择门店" : "店舗未選択") : store.name;
        String brandLabel = brand == null || brand.id.isEmpty() ? allBrands : brand.name;
        if (scopeSummary != null) scopeSummary.setText(storeLabel + "  ·  " + brandLabel);
        boolean ready = store != null && !store.id.isEmpty() && brandSpinner != null && brandSpinner.getAdapter() != null;
        if (saveButton != null) {
            saveButton.setEnabled(ready);
            saveButton.setAlpha(ready ? 1f : 0.45f);
        }
    }

    private void save() {
        Choice language = (Choice) languageSpinner.getSelectedItem();
        Choice store = selected(storeSpinner, stores);
        Choice brand = selected(brandSpinner, brands);
        if (store == null || store.id.isEmpty()) return;
        InventoryWidgetProvider.saveConfiguration(
            this,
            widgetId,
            language == null ? InventoryWidgetProvider.LANGUAGE_JA : language.id,
            store.id,
            store.name,
            brand == null ? "" : brand.id,
            brand == null || brand.id.isEmpty() ? "" : brand.name
        );
        InventoryWidgetProvider.refreshWidget(this, widgetId);
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    private ArrayAdapter<Choice> adapter(List<Choice> choices) {
        ArrayAdapter<Choice> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, choices);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private List<Choice> listOf(Choice first, Choice second) {
        List<Choice> choices = new ArrayList<>();
        choices.add(first);
        choices.add(second);
        return choices;
    }

    private int indexOf(List<Choice> choices, String id) {
        for (int index = 0; index < choices.size(); index += 1) {
            if (choices.get(index).id.equals(id)) return index;
        }
        return -1;
    }

    private Choice selected(Spinner spinner, List<Choice> choices) {
        if (spinner == null || choices.isEmpty()) return null;
        int position = spinner.getSelectedItemPosition();
        return position >= 0 && position < choices.size() ? choices.get(position) : null;
    }

    private AdapterView.OnItemSelectedListener simpleSelection(Runnable action) {
        return new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { action.run(); }
            @Override public void onNothingSelected(AdapterView<?> parent) { action.run(); }
        };
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
