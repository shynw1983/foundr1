package jp.foundr1.store;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class QuickInventoryActivity extends Activity {
    public static final String EXTRA_MODE = "inventory_mode";
    public static final String EXTRA_LANGUAGE = "inventory_language";
    public static final String EXTRA_STORE_ID = "inventory_store_id";
    public static final String EXTRA_STORE_NAME = "inventory_store_name";
    public static final String EXTRA_BRAND_ID = "inventory_brand_id";
    public static final String EXTRA_BRAND_NAME = "inventory_brand_name";
    public static final String MODE_SHORTAGE = "shortage";
    public static final String MODE_RESTORE = "restore";
    private static final String UI_PREFERENCES = "quick_inventory_ui";

    static final class InventoryItem {
        final String key;
        final String label;
        final String actionLabel;
        final String kind;
        final String brandId;
        final String brandLabel;
        final String storeId;
        final String groupKey;
        final String groupLabel;
        final int impactCount;
        final boolean available;
        final String searchText;

        InventoryItem(
            String key,
            String label,
            String actionLabel,
            String kind,
            String brandId,
            String brandLabel,
            String storeId,
            String groupKey,
            String groupLabel,
            int impactCount,
            boolean available,
            String searchText
        ) {
            this.key = key;
            this.label = label;
            this.actionLabel = actionLabel;
            this.kind = kind;
            this.brandId = brandId;
            this.brandLabel = brandLabel;
            this.storeId = storeId;
            this.groupKey = groupKey;
            this.groupLabel = groupLabel;
            this.impactCount = impactCount;
            this.available = available;
            this.searchText = searchText;
        }
    }

    private static final class DisplayRow {
        final boolean header;
        final String groupKey;
        final String groupLabel;
        final String brandLabel;
        final String kind;
        final List<InventoryItem> groupItems;
        final InventoryItem item;

        private DisplayRow(
            boolean header,
            String groupKey,
            String groupLabel,
            String brandLabel,
            String kind,
            List<InventoryItem> groupItems,
            InventoryItem item
        ) {
            this.header = header;
            this.groupKey = groupKey;
            this.groupLabel = groupLabel;
            this.brandLabel = brandLabel;
            this.kind = kind;
            this.groupItems = groupItems;
            this.item = item;
        }

        static DisplayRow header(List<InventoryItem> items) {
            InventoryItem first = items.get(0);
            return new DisplayRow(true, first.groupKey, first.groupLabel, first.brandLabel, first.kind, items, null);
        }

        static DisplayRow item(InventoryItem item) {
            return new DisplayRow(false, item.groupKey, item.groupLabel, item.brandLabel, item.kind, null, item);
        }
    }

    private final List<InventoryItem> allItems = new ArrayList<>();
    private final List<InventoryItem> relevantItems = new ArrayList<>();
    private final List<DisplayRow> displayRows = new ArrayList<>();
    private final Set<String> selectedKeys = new HashSet<>();
    private final Set<String> collapsedGroupKeys = new HashSet<>();
    private String mode = MODE_SHORTAGE;
    private String language = InventoryWidgetProvider.LANGUAGE_JA;
    private String selectedStoreId = "";
    private String selectedStoreName = "";
    private String selectedBrandId = "";
    private String selectedBrandName = "";
    private String kindFilter = "all";
    private String groupFilter = "";
    private EditText searchInput;
    private TextView resultStatus;
    private LinearLayout selectionBar;
    private TextView selectedSummary;
    private Button submitButton;
    private ProgressBar loading;
    private InventoryAdapter adapter;
    private boolean submitting = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        mode = MODE_RESTORE.equals(getIntent().getStringExtra(EXTRA_MODE)) ? MODE_RESTORE : MODE_SHORTAGE;
        language = InventoryWidgetProvider.LANGUAGE_ZH.equals(getIntent().getStringExtra(EXTRA_LANGUAGE))
            ? InventoryWidgetProvider.LANGUAGE_ZH
            : InventoryWidgetProvider.LANGUAGE_JA;
        readScope(getIntent());
        Set<String> savedCollapsed = getSharedPreferences(UI_PREFERENCES, MODE_PRIVATE)
            .getStringSet(collapsedPreferenceKey(), new HashSet<>());
        if (savedCollapsed != null) collapsedGroupKeys.addAll(savedCollapsed);
        setContentView(buildContent());

        JSONObject cached = InventoryApiClient.readCache(this, selectedStoreId);
        if (cached != null) showInventory(cached, false);
        loadInventory();
        searchInput.postDelayed(() -> {
            searchInput.requestFocus();
            InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.showSoftInput(searchInput, InputMethodManager.SHOW_IMPLICIT);
        }, 220);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String nextMode = MODE_RESTORE.equals(intent.getStringExtra(EXTRA_MODE)) ? MODE_RESTORE : MODE_SHORTAGE;
        String nextLanguage = InventoryWidgetProvider.LANGUAGE_ZH.equals(intent.getStringExtra(EXTRA_LANGUAGE))
            ? InventoryWidgetProvider.LANGUAGE_ZH
            : InventoryWidgetProvider.LANGUAGE_JA;
        String nextStoreId = safe(intent.getStringExtra(EXTRA_STORE_ID));
        String nextBrandId = safe(intent.getStringExtra(EXTRA_BRAND_ID));
        if (!nextMode.equals(mode) || !nextLanguage.equals(language)
            || !nextStoreId.equals(selectedStoreId) || !nextBrandId.equals(selectedBrandId)) {
            setIntent(intent);
            recreate();
            return;
        }
        setIntent(intent);
        selectedKeys.clear();
        groupFilter = "";
        filterItems();
    }

    private View buildContent() {
        FrameLayout root = new FrameLayout(this);
        root.setOnClickListener(view -> {
            if (!submitting) finish();
        });

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(18), dp(14), dp(18), dp(18));
        panel.setClickable(true);
        GradientDrawable panelBackground = new GradientDrawable();
        panelBackground.setColor(Color.WHITE);
        panelBackground.setCornerRadii(new float[] { dp(22), dp(22), dp(22), dp(22), 0, 0, 0, 0 });
        panel.setBackground(panelBackground);
        int panelHeight = (int) (getResources().getDisplayMetrics().heightPixels * 0.92f);
        root.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, panelHeight, Gravity.BOTTOM));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText(MODE_RESTORE.equals(mode) ? t("入荷・販売再開", "到货・恢复销售") : t("欠品登録", "设置缺货"));
        title.setTextColor(Color.rgb(20, 43, 35));
        title.setTextSize(21);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button close = new Button(this);
        close.setText("×");
        close.setTextSize(24);
        close.setTextColor(Color.DKGRAY);
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setOnClickListener(view -> {
            if (!submitting) finish();
        });
        header.addView(close, new LinearLayout.LayoutParams(dp(52), dp(48)));
        panel.addView(header);

        TextView scope = new TextView(this);
        scope.setText(scopeLabel());
        scope.setTextColor(Color.rgb(19, 78, 58));
        scope.setTextSize(14);
        scope.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        scope.setGravity(Gravity.CENTER_VERTICAL);
        scope.setPadding(dp(12), 0, dp(12), 0);
        scope.setBackground(rounded(Color.rgb(236, 244, 240), 10));
        LinearLayout.LayoutParams scopeParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42));
        scopeParams.setMargins(0, 0, 0, dp(8));
        panel.addView(scope, scopeParams);

        searchInput = new EditText(this);
        searchInput.setSingleLine(true);
        searchInput.setHint(t("商品・グループ・ブランドを検索", "搜索商品、分组或品牌"));
        searchInput.setTextSize(16);
        searchInput.setPadding(dp(14), 0, dp(14), 0);
        GradientDrawable searchBackground = rounded(Color.rgb(245, 247, 246), 12);
        searchBackground.setStroke(dp(1), Color.rgb(210, 219, 215));
        searchInput.setBackground(searchBackground);
        panel.addView(searchInput, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) { filterItems(); }
            @Override public void afterTextChanged(Editable value) {}
        });

        LinearLayout filters = new LinearLayout(this);
        filters.setPadding(0, dp(8), 0, dp(6));
        filters.addView(filterButton(t("すべて", "全部"), "all"), new LinearLayout.LayoutParams(0, dp(38), 1));
        filters.addView(filterButton(t("商品", "商品"), "item"), new LinearLayout.LayoutParams(0, dp(38), 1));
        filters.addView(filterButton(t("食材・選択肢", "食材・选项"), "option"), new LinearLayout.LayoutParams(0, dp(38), 1));
        panel.addView(filters);

        FrameLayout listFrame = new FrameLayout(this);
        ListView list = new ListView(this);
        list.setDivider(new ColorDrawable(Color.rgb(229, 233, 231)));
        list.setDividerHeight(dp(1));
        adapter = new InventoryAdapter();
        list.setAdapter(adapter);
        listFrame.addView(list, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        loading = new ProgressBar(this);
        listFrame.addView(loading, new FrameLayout.LayoutParams(dp(42), dp(42), Gravity.CENTER));
        panel.addView(listFrame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        selectionBar = new LinearLayout(this);
        selectionBar.setGravity(Gravity.CENTER_VERTICAL);
        selectionBar.setPadding(dp(12), dp(4), dp(4), dp(4));
        selectionBar.setBackground(rounded(Color.rgb(236, 244, 240), 10));
        selectedSummary = new TextView(this);
        selectedSummary.setTextColor(Color.rgb(19, 78, 58));
        selectedSummary.setTextSize(14);
        selectedSummary.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        selectedSummary.setOnClickListener(view -> showSelectedItems());
        selectionBar.addView(selectedSummary, new LinearLayout.LayoutParams(0, dp(42), 1));
        Button clear = new Button(this);
        clear.setText(t("選択解除", "清除"));
        clear.setTextSize(12);
        clear.setTextColor(Color.rgb(19, 78, 58));
        clear.setBackgroundColor(Color.TRANSPARENT);
        clear.setOnClickListener(view -> {
            selectedKeys.clear();
            adapter.notifyDataSetChanged();
            updateSubmitButton();
        });
        selectionBar.addView(clear, new LinearLayout.LayoutParams(dp(92), dp(42)));
        panel.addView(selectionBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));

        resultStatus = new TextView(this);
        resultStatus.setTextColor(Color.GRAY);
        resultStatus.setTextSize(13);
        resultStatus.setPadding(0, dp(6), 0, dp(7));
        resultStatus.setOnClickListener(view -> {
            if (!groupFilter.isEmpty()) {
                groupFilter = "";
                filterItems();
            }
        });
        panel.addView(resultStatus);

        submitButton = new Button(this);
        submitButton.setTextColor(Color.WHITE);
        submitButton.setTextSize(16);
        submitButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        submitButton.setBackground(rounded(MODE_RESTORE.equals(mode) ? Color.rgb(19, 78, 58) : Color.rgb(151, 43, 43), 12));
        submitButton.setOnClickListener(view -> confirmSubmit());
        panel.addView(submitButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        updateSubmitButton();
        return root;
    }

    private Button filterButton(String label, String value) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(13);
        button.setTextColor(Color.rgb(31, 65, 53));
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setMinWidth(0);
        button.setPadding(dp(2), 0, dp(2), 0);
        button.setOnClickListener(view -> {
            kindFilter = value;
            groupFilter = "";
            filterItems();
        });
        return button;
    }

    private void loadInventory() {
        loading.setVisibility(View.VISIBLE);
        resultStatus.setText(t("最新状態を読み込み中…", "正在读取最新状态…"));
        new Thread(() -> {
            try {
                JSONObject body = InventoryApiClient.loadAll(selectedStoreId);
                InventoryApiClient.saveCache(this, selectedStoreId, body);
                runOnUiThread(() -> showInventory(body, true));
            } catch (Exception error) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    resultStatus.setText(allItems.isEmpty()
                        ? error.getMessage()
                        : t("保存済み一覧を表示中。最新状態を取得できません。", "正在显示缓存列表，无法获取最新状态。"));
                });
            }
        }, "foundr1-inventory-load").start();
    }

    private void showInventory(JSONObject body, boolean fresh) {
        JSONArray rows = body.optJSONArray("items");
        if (rows == null) return;
        allItems.clear();
        for (int index = 0; index < rows.length(); index += 1) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null) continue;
            String actionLabel = row.optString("ingredientLabel", "").trim();
            if (actionLabel.isEmpty()) continue;
            JSONObject displayNames = row.optJSONObject("displayNames");
            String label = localizedValue(displayNames, actionLabel);
            String kind = row.optString("targetKind", "option");
            String brandId = row.optString("brandId");
            String brandLabel = row.optString("brandName", brandId).trim();
            if (brandLabel.isEmpty()) brandLabel = t("ブランド未設定", "未设置品牌");
            String rawGroup = "item".equals(kind)
                ? row.optString("category", row.optString("groupName"))
                : row.optString("groupName");
            String groupLabel = localizedValue(row.optJSONObject("groupDisplayNames"), rawGroup);
            if (groupLabel.isEmpty()) groupLabel = t("未分類", "未分组");
            String groupKey = brandId + ":" + kind + ":" + normalize(rawGroup.isEmpty() ? groupLabel : rawGroup);
            StringBuilder search = new StringBuilder(actionLabel)
                .append(' ').append(label)
                .append(' ').append(brandLabel)
                .append(' ').append(groupLabel);
            JSONArray aliases = row.optJSONArray("searchLabels");
            if (aliases != null) {
                for (int aliasIndex = 0; aliasIndex < aliases.length(); aliasIndex += 1) {
                    search.append(' ').append(aliases.optString(aliasIndex));
                }
            }
            JSONArray groupNames = row.optJSONArray("groupNames");
            if (groupNames != null) {
                for (int groupIndex = 0; groupIndex < groupNames.length(); groupIndex += 1) {
                    search.append(' ').append(groupNames.optString(groupIndex));
                }
            }
            String key = brandId + ":" + kind + ":" + row.optString("inventoryKey");
            allItems.add(new InventoryItem(
                key,
                label,
                actionLabel,
                kind,
                brandId,
                brandLabel,
                row.optString("storeId", body.optString("storeId")),
                groupKey,
                groupLabel,
                Math.max(1, row.optInt("impactCount", 1)),
                row.optBoolean("isAvailable", true),
                normalize(search.toString())
            ));
        }
        loading.setVisibility(View.GONE);
        filterItems();
        if (fresh) InventoryWidgetProvider.refreshWidgets(this);
    }

    private void filterItems() {
        if (adapter == null || searchInput == null) return;
        String query = normalize(searchInput.getText().toString());
        relevantItems.clear();
        Map<String, List<InventoryItem>> grouped = new LinkedHashMap<>();
        for (InventoryItem item : allItems) {
            boolean relevantState = MODE_RESTORE.equals(mode) ? !item.available : item.available;
            boolean relevantKind = "all".equals(kindFilter) || kindFilter.equals(item.kind);
            boolean relevantBrand = selectedBrandId.isEmpty() || selectedBrandId.equals(item.brandId);
            boolean relevantGroup = groupFilter.isEmpty() || groupFilter.equals(item.groupKey);
            boolean matches = query.isEmpty() || item.searchText.contains(query);
            if (!relevantState || !relevantKind || !relevantBrand || !relevantGroup || !matches) continue;
            relevantItems.add(item);
            grouped.computeIfAbsent(item.groupKey, ignored -> new ArrayList<>()).add(item);
        }
        displayRows.clear();
        for (List<InventoryItem> groupItems : grouped.values()) {
            DisplayRow header = DisplayRow.header(groupItems);
            displayRows.add(header);
            boolean collapsed = query.isEmpty() && collapsedGroupKeys.contains(header.groupKey);
            if (!collapsed) for (InventoryItem item : groupItems) displayRows.add(DisplayRow.item(item));
        }
        adapter.notifyDataSetChanged();
        String countLabel = relevantItems.isEmpty()
            ? (MODE_RESTORE.equals(mode)
                ? t("現在、欠品中の項目はありません。", "当前没有缺货项目。")
                : t("該当する項目がありません。", "没有符合条件的项目。"))
            : t(relevantItems.size() + "件・" + grouped.size() + "グループ", relevantItems.size() + " 项・" + grouped.size() + " 个分组");
        if (!groupFilter.isEmpty()) countLabel += t(" · タップで全グループ表示", " · 点击显示全部分组");
        resultStatus.setText(countLabel);
        updateSubmitButton();
    }

    private void confirmSubmit() {
        if (submitting || selectedKeys.isEmpty()) return;
        List<InventoryItem> selected = selectedItems();
        int impact = 0;
        Set<String> groups = new HashSet<>();
        for (InventoryItem item : selected) {
            impact += item.impactCount;
            groups.add(item.groupKey);
        }
        String action = MODE_RESTORE.equals(mode) ? t("販売を再開", "恢复销售") : t("欠品に変更", "设为缺货");
        String message = isChinese()
            ? scopeLabel() + "\n已选择 " + selected.size() + " 项，来自 " + groups.size() + " 个分组。\n预计影响 " + impact + " 个关联商品或选项，并同步到已连接的销售渠道。"
            : scopeLabel() + "\n" + selected.size() + "件・" + groups.size() + "グループを選択中です。\n関連する商品・選択肢 " + impact + "件へ反映し、連携済み販売チャネルにも同期します。";
        new AlertDialog.Builder(this)
            .setTitle(isChinese() ? "确定" + action + "吗？" : action + "しますか？")
            .setMessage(message)
            .setNegativeButton(t("キャンセル", "取消"), null)
            .setNeutralButton(t("選択内容", "查看已选"), (dialog, which) -> showSelectedItems())
            .setPositiveButton(action, (dialog, which) -> submitSelection())
            .show();
    }

    private void submitSelection() {
        List<InventoryItem> selected = selectedItems();
        if (selected.isEmpty()) return;
        submitting = true;
        searchInput.setEnabled(false);
        submitButton.setEnabled(false);
        boolean makeAvailable = MODE_RESTORE.equals(mode);
        new Thread(() -> {
            int succeeded = 0;
            String lastError = "";
            for (int index = 0; index < selected.size(); index += 1) {
                int progress = index + 1;
                runOnUiThread(() -> submitButton.setText(t("更新中 ", "更新中 ") + progress + " / " + selected.size()));
                try {
                    InventoryApiClient.apply(selected.get(index), makeAvailable);
                    succeeded += 1;
                } catch (Exception error) {
                    lastError = error.getMessage() == null ? t("更新できませんでした。", "无法更新。") : error.getMessage();
                }
            }
            int successCount = succeeded;
            String errorMessage = lastError;
            runOnUiThread(() -> finishSubmission(selected, makeAvailable, successCount, errorMessage));
        }, "foundr1-inventory-submit").start();
    }

    private void finishSubmission(List<InventoryItem> selected, boolean makeAvailable, int successCount, String errorMessage) {
        submitting = false;
        searchInput.setEnabled(true);
        if (successCount == selected.size()) {
            Toast.makeText(
                this,
                isChinese()
                    ? "已更新 " + successCount + " 项为" + (makeAvailable ? "恢复销售" : "缺货") + "。"
                    : successCount + "件を" + (makeAvailable ? "販売再開" : "欠品登録") + "しました。",
                Toast.LENGTH_LONG
            ).show();
            InventoryWidgetProvider.refreshWidgets(this);
            finish();
            return;
        }
        selectedKeys.clear();
        updateSubmitButton();
        new AlertDialog.Builder(this)
            .setTitle(t("一部を更新できませんでした", "部分项目更新失败"))
            .setMessage(isChinese()
                ? "已更新 " + successCount + " / " + selected.size() + " 项。\n" + errorMessage
                : successCount + " / " + selected.size() + "件を更新しました。\n" + errorMessage)
            .setPositiveButton(t("確認", "确认"), null)
            .show();
        loadInventory();
    }

    private List<InventoryItem> selectedItems() {
        List<InventoryItem> selected = new ArrayList<>();
        for (InventoryItem item : allItems) if (selectedKeys.contains(item.key)) selected.add(item);
        return selected;
    }

    private void showSelectedItems() {
        List<InventoryItem> selected = selectedItems();
        if (selected.isEmpty()) return;
        StringBuilder message = new StringBuilder();
        int shown = Math.min(selected.size(), 20);
        for (int index = 0; index < shown; index += 1) {
            InventoryItem item = selected.get(index);
            if (index > 0) message.append('\n');
            message.append("• ").append(item.label).append("\n   ").append(item.brandLabel).append(" · ").append(item.groupLabel);
        }
        if (selected.size() > shown) message.append("\n… +").append(selected.size() - shown).append(t("件", " 项"));
        new AlertDialog.Builder(this)
            .setTitle(t("選択中 ", "已选择 ") + selected.size() + t("件", " 项"))
            .setMessage(message.toString())
            .setNegativeButton(t("すべて解除", "全部清除"), (dialog, which) -> {
                selectedKeys.clear();
                adapter.notifyDataSetChanged();
                updateSubmitButton();
            })
            .setPositiveButton(t("閉じる", "关闭"), null)
            .show();
    }

    private void updateSubmitButton() {
        if (submitButton == null || submitting) return;
        int count = selectedKeys.size();
        selectionBar.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
        if (count > 0) {
            int impact = 0;
            for (InventoryItem item : allItems) if (selectedKeys.contains(item.key)) impact += item.impactCount;
            selectedSummary.setText(isChinese()
                ? "已选择 " + count + " 项 · 预计影响 " + impact + " 项（点击查看）"
                : count + "件選択 · 関連 " + impact + "件（タップで確認）");
        }
        submitButton.setText(count == 0
            ? t("項目を選択してください", "请选择项目")
            : (isChinese()
                ? (MODE_RESTORE.equals(mode) ? "恢复销售 " : "设置缺货 ") + count + " 项"
                : count + "件を" + (MODE_RESTORE.equals(mode) ? "販売再開" : "欠品登録")));
        submitButton.setEnabled(count > 0);
        submitButton.setAlpha(count > 0 ? 1f : 0.45f);
    }

    private void toggleSelection(InventoryItem item) {
        if (submitting || item == null) return;
        if (selectedKeys.contains(item.key)) selectedKeys.remove(item.key);
        else selectedKeys.add(item.key);
        adapter.notifyDataSetChanged();
        updateSubmitButton();
    }

    private void toggleGroupSelection(List<InventoryItem> items) {
        if (submitting || items == null || items.isEmpty()) return;
        boolean allSelected = true;
        for (InventoryItem item : items) if (!selectedKeys.contains(item.key)) allSelected = false;
        for (InventoryItem item : items) {
            if (allSelected) selectedKeys.remove(item.key);
            else selectedKeys.add(item.key);
        }
        adapter.notifyDataSetChanged();
        updateSubmitButton();
    }

    private void toggleGroupCollapse(String key) {
        if (collapsedGroupKeys.contains(key)) collapsedGroupKeys.remove(key);
        else collapsedGroupKeys.add(key);
        getSharedPreferences(UI_PREFERENCES, MODE_PRIVATE)
            .edit()
            .putStringSet(collapsedPreferenceKey(), new HashSet<>(collapsedGroupKeys))
            .apply();
        filterItems();
    }

    private String collapsedPreferenceKey() {
        return "collapsed_" + language + "_" + mode;
    }

    private String localizedValue(JSONObject displayNames, String fallback) {
        if (!isChinese() || displayNames == null) return fallback == null ? "" : fallback.trim();
        String localized = displayNames.optString("zh", fallback == null ? "" : fallback).trim();
        return localized.isEmpty() ? (fallback == null ? "" : fallback.trim()) : localized;
    }

    private void readScope(Intent intent) {
        selectedStoreId = safe(intent.getStringExtra(EXTRA_STORE_ID));
        selectedStoreName = safe(intent.getStringExtra(EXTRA_STORE_NAME));
        selectedBrandId = safe(intent.getStringExtra(EXTRA_BRAND_ID));
        selectedBrandName = safe(intent.getStringExtra(EXTRA_BRAND_NAME));
    }

    private String scopeLabel() {
        String store = selectedStoreName.isEmpty() ? t("店舗未設定", "未设置门店") : selectedStoreName;
        String brand = selectedBrandName.isEmpty() ? t("全ブランド", "全部品牌") : selectedBrandName;
        return store + "  ·  " + brand;
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private boolean isChinese() {
        return InventoryWidgetProvider.LANGUAGE_ZH.equals(language);
    }

    private String t(String japanese, String chinese) {
        return isChinese() ? chinese : japanese;
    }

    private String normalize(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
            .toLowerCase(Locale.ROOT)
            .replaceAll("[\\s　・·|｜()（）「」『』【】\\[\\]\"'’“”.,。、:：;；!！?？\\-_/\\\\]", "");
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

    private final class InventoryAdapter extends BaseAdapter {
        @Override public int getCount() { return displayRows.size(); }
        @Override public Object getItem(int position) { return displayRows.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public int getItemViewType(int position) { return displayRows.get(position).header ? 0 : 1; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            DisplayRow rowData = displayRows.get(position);
            return rowData.header
                ? bindHeaderRow(rowData, convertView)
                : bindItemRow(rowData.item, convertView);
        }

        private View bindHeaderRow(DisplayRow rowData, View convertView) {
            HeaderHolder holder;
            if (convertView == null) {
                LinearLayout row = new LinearLayout(QuickInventoryActivity.this);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setPadding(dp(10), dp(7), dp(4), dp(7));
                row.setBackgroundColor(Color.rgb(241, 246, 243));
                LinearLayout copy = new LinearLayout(QuickInventoryActivity.this);
                copy.setOrientation(LinearLayout.VERTICAL);
                TextView title = new TextView(QuickInventoryActivity.this);
                title.setTextColor(Color.rgb(20, 60, 46));
                title.setTextSize(14);
                title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                TextView meta = new TextView(QuickInventoryActivity.this);
                meta.setTextColor(Color.rgb(91, 110, 103));
                meta.setTextSize(11);
                copy.addView(title);
                copy.addView(meta);
                row.addView(copy, new LinearLayout.LayoutParams(0, dp(48), 1));
                Button filter = compactButton(t("絞込", "筛选"), 58);
                Button select = compactButton(t("全選択", "全选"), 66);
                row.addView(filter, new LinearLayout.LayoutParams(dp(58), dp(42)));
                row.addView(select, new LinearLayout.LayoutParams(dp(66), dp(42)));
                holder = new HeaderHolder(row, title, meta, filter, select);
                row.setTag(holder);
                convertView = row;
            } else {
                holder = (HeaderHolder) convertView.getTag();
            }
            boolean collapsed = collapsedGroupKeys.contains(rowData.groupKey) && normalize(searchInput.getText().toString()).isEmpty();
            int selected = 0;
            for (InventoryItem item : rowData.groupItems) if (selectedKeys.contains(item.key)) selected += 1;
            holder.title.setText((collapsed ? "▸ " : "▾ ") + rowData.groupLabel);
            String kindLabel = "item".equals(rowData.kind) ? t("商品", "商品") : t("食材・選択肢", "食材・选项");
            holder.meta.setText(rowData.brandLabel + " · " + kindLabel + " · " + rowData.groupItems.size() + t("件", " 项")
                + (selected > 0 ? t(" · 選択 ", " · 已选 ") + selected : ""));
            holder.filter.setText(groupFilter.equals(rowData.groupKey) ? t("解除", "全部") : t("絞込", "筛选"));
            holder.filter.setOnClickListener(view -> {
                groupFilter = groupFilter.equals(rowData.groupKey) ? "" : rowData.groupKey;
                filterItems();
            });
            holder.select.setText(selected == rowData.groupItems.size() ? t("解除", "清除") : t("全選択", "全选"));
            holder.select.setOnClickListener(view -> toggleGroupSelection(rowData.groupItems));
            holder.root.setOnClickListener(view -> toggleGroupCollapse(rowData.groupKey));
            return convertView;
        }

        private View bindItemRow(InventoryItem item, View convertView) {
            ItemHolder holder;
            if (convertView == null) {
                LinearLayout row = new LinearLayout(QuickInventoryActivity.this);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setPadding(dp(4), dp(7), dp(4), dp(7));
                row.setClickable(true);
                row.setFocusable(true);
                row.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
                CheckBox check = new CheckBox(QuickInventoryActivity.this);
                check.setClickable(false);
                check.setFocusable(false);
                check.setFocusableInTouchMode(false);
                row.addView(check, new LinearLayout.LayoutParams(dp(48), dp(48)));
                LinearLayout copy = new LinearLayout(QuickInventoryActivity.this);
                copy.setOrientation(LinearLayout.VERTICAL);
                TextView label = new TextView(QuickInventoryActivity.this);
                label.setTextColor(Color.rgb(25, 42, 36));
                label.setTextSize(16);
                TextView meta = new TextView(QuickInventoryActivity.this);
                meta.setTextColor(Color.GRAY);
                meta.setTextSize(12);
                copy.addView(label);
                copy.addView(meta);
                row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                holder = new ItemHolder(check, label, meta);
                row.setTag(holder);
                convertView = row;
            } else {
                holder = (ItemHolder) convertView.getTag();
            }
            holder.check.setChecked(selectedKeys.contains(item.key));
            holder.label.setText(item.label);
            String impact = item.impactCount > 1
                ? t(" · 関連 " + item.impactCount + "件", " · 关联 " + item.impactCount + " 项")
                : "";
            holder.meta.setText(item.brandLabel + " · " + item.groupLabel + impact);
            convertView.setOnClickListener(view -> toggleSelection(item));
            return convertView;
        }

        private Button compactButton(String label, int widthDp) {
            Button button = new Button(QuickInventoryActivity.this);
            button.setText(label);
            button.setTextSize(11);
            button.setTextColor(Color.rgb(19, 78, 58));
            button.setBackgroundColor(Color.TRANSPARENT);
            button.setMinWidth(0);
            button.setPadding(dp(1), 0, dp(1), 0);
            return button;
        }
    }

    private static final class HeaderHolder {
        final LinearLayout root;
        final TextView title;
        final TextView meta;
        final Button filter;
        final Button select;

        HeaderHolder(LinearLayout root, TextView title, TextView meta, Button filter, Button select) {
            this.root = root;
            this.title = title;
            this.meta = meta;
            this.filter = filter;
            this.select = select;
        }
    }

    private static final class ItemHolder {
        final CheckBox check;
        final TextView label;
        final TextView meta;

        ItemHolder(CheckBox check, TextView label, TextView meta) {
            this.check = check;
            this.label = label;
            this.meta = meta;
        }
    }
}
