package jp.foundr1.store;

import android.app.Activity;
import android.app.AlertDialog;
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
import android.content.Context;
import android.content.Intent;
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
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class QuickInventoryActivity extends Activity {
    public static final String EXTRA_MODE = "inventory_mode";
    public static final String MODE_SHORTAGE = "shortage";
    public static final String MODE_RESTORE = "restore";

    static final class InventoryItem {
        final String key;
        final String label;
        final String kind;
        final String brandId;
        final String storeId;
        final boolean available;
        final String searchText;

        InventoryItem(String key, String label, String kind, String brandId, String storeId, boolean available, String searchText) {
            this.key = key;
            this.label = label;
            this.kind = kind;
            this.brandId = brandId;
            this.storeId = storeId;
            this.available = available;
            this.searchText = searchText;
        }
    }

    private final List<InventoryItem> allItems = new ArrayList<>();
    private final List<InventoryItem> visibleItems = new ArrayList<>();
    private final Set<String> selectedKeys = new HashSet<>();
    private String mode = MODE_SHORTAGE;
    private String kindFilter = "all";
    private EditText searchInput;
    private TextView resultStatus;
    private Button submitButton;
    private ProgressBar loading;
    private InventoryAdapter adapter;
    private boolean submitting = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        mode = MODE_RESTORE.equals(getIntent().getStringExtra(EXTRA_MODE)) ? MODE_RESTORE : MODE_SHORTAGE;
        setContentView(buildContent());

        JSONObject cached = InventoryApiClient.readCache(this);
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
        if (!nextMode.equals(mode)) {
            setIntent(intent);
            recreate();
            return;
        }
        setIntent(intent);
        selectedKeys.clear();
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
        int panelHeight = (int) (getResources().getDisplayMetrics().heightPixels * 0.90f);
        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            panelHeight,
            Gravity.BOTTOM
        );
        root.addView(panel, panelParams);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText(MODE_RESTORE.equals(mode) ? "入荷・販売再開" : "欠品登録");
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

        searchInput = new EditText(this);
        searchInput.setSingleLine(true);
        searchInput.setHint("商品・食材・選択肢を検索");
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
        filters.setPadding(0, dp(9), 0, dp(7));
        filters.addView(filterButton("すべて", "all"), new LinearLayout.LayoutParams(0, dp(40), 1));
        filters.addView(filterButton("商品", "item"), new LinearLayout.LayoutParams(0, dp(40), 1));
        filters.addView(filterButton("食材・選択肢", "option"), new LinearLayout.LayoutParams(0, dp(40), 1));
        panel.addView(filters);

        FrameLayout listFrame = new FrameLayout(this);
        ListView list = new ListView(this);
        list.setDivider(new ColorDrawable(Color.rgb(229, 233, 231)));
        list.setDividerHeight(dp(1));
        list.setChoiceMode(ListView.CHOICE_MODE_MULTIPLE);
        adapter = new InventoryAdapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, row, position, id) -> {
            if (submitting) return;
            InventoryItem item = visibleItems.get(position);
            if (selectedKeys.contains(item.key)) selectedKeys.remove(item.key);
            else selectedKeys.add(item.key);
            adapter.notifyDataSetChanged();
            updateSubmitButton();
        });
        listFrame.addView(list, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        loading = new ProgressBar(this);
        FrameLayout.LayoutParams loadingParams = new FrameLayout.LayoutParams(dp(42), dp(42), Gravity.CENTER);
        listFrame.addView(loading, loadingParams);
        panel.addView(listFrame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        resultStatus = new TextView(this);
        resultStatus.setTextColor(Color.GRAY);
        resultStatus.setTextSize(13);
        resultStatus.setPadding(0, dp(8), 0, dp(8));
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
            filterItems();
        });
        return button;
    }

    private void loadInventory() {
        loading.setVisibility(View.VISIBLE);
        resultStatus.setText("最新状態を読み込み中…");
        new Thread(() -> {
            try {
                JSONObject body = InventoryApiClient.loadAll();
                InventoryApiClient.saveCache(this, body);
                runOnUiThread(() -> showInventory(body, true));
            } catch (Exception error) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    if (allItems.isEmpty()) {
                        resultStatus.setText(error.getMessage());
                    } else {
                        resultStatus.setText("最新状態を取得できないため、保存済み一覧を表示しています。");
                    }
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
            String label = row.optString("ingredientLabel", "").trim();
            if (label.isEmpty()) continue;
            StringBuilder search = new StringBuilder(label);
            JSONArray aliases = row.optJSONArray("searchLabels");
            if (aliases != null) {
                for (int aliasIndex = 0; aliasIndex < aliases.length(); aliasIndex += 1) {
                    search.append(' ').append(aliases.optString(aliasIndex));
                }
            }
            String key = row.optString("brandId") + ":" + row.optString("targetKind") + ":" + row.optString("inventoryKey");
            allItems.add(new InventoryItem(
                key,
                label,
                row.optString("targetKind", "option"),
                row.optString("brandId"),
                row.optString("storeId", body.optString("storeId")),
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
        visibleItems.clear();
        for (InventoryItem item : allItems) {
            boolean relevantState = MODE_RESTORE.equals(mode) ? !item.available : item.available;
            boolean relevantKind = "all".equals(kindFilter) || kindFilter.equals(item.kind);
            boolean matches = query.isEmpty() || item.searchText.contains(query);
            if (relevantState && relevantKind && matches) visibleItems.add(item);
        }
        adapter.notifyDataSetChanged();
        resultStatus.setText(visibleItems.isEmpty()
            ? (MODE_RESTORE.equals(mode) ? "現在、欠品中の項目はありません。" : "該当する項目がありません。")
            : visibleItems.size() + "件を表示");
        updateSubmitButton();
    }

    private void confirmSubmit() {
        if (submitting || selectedKeys.isEmpty()) return;
        String action = MODE_RESTORE.equals(mode) ? "販売を再開" : "欠品に変更";
        new AlertDialog.Builder(this)
            .setTitle(action + "しますか？")
            .setMessage(selectedKeys.size() + "件をまとめて更新します。連携済みの販売チャネルにも同期されます。")
            .setNegativeButton("キャンセル", null)
            .setPositiveButton(action, (dialog, which) -> submitSelection())
            .show();
    }

    private void submitSelection() {
        List<InventoryItem> selected = new ArrayList<>();
        for (InventoryItem item : allItems) if (selectedKeys.contains(item.key)) selected.add(item);
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
                runOnUiThread(() -> submitButton.setText("更新中 " + progress + " / " + selected.size()));
                try {
                    InventoryApiClient.apply(selected.get(index), makeAvailable);
                    succeeded += 1;
                } catch (Exception error) {
                    lastError = error.getMessage() == null ? "更新できませんでした。" : error.getMessage();
                }
            }
            int successCount = succeeded;
            String errorMessage = lastError;
            runOnUiThread(() -> {
                submitting = false;
                searchInput.setEnabled(true);
                if (successCount == selected.size()) {
                    Toast.makeText(
                        this,
                        successCount + "件を" + (makeAvailable ? "販売再開" : "欠品登録") + "しました。",
                        Toast.LENGTH_LONG
                    ).show();
                    InventoryWidgetProvider.refreshWidgets(this);
                    finish();
                    return;
                }
                selectedKeys.clear();
                updateSubmitButton();
                new AlertDialog.Builder(this)
                    .setTitle("一部を更新できませんでした")
                    .setMessage(successCount + " / " + selected.size() + "件を更新しました。\n" + errorMessage)
                    .setPositiveButton("確認", null)
                    .show();
                loadInventory();
            });
        }, "foundr1-inventory-submit").start();
    }

    private void updateSubmitButton() {
        if (submitButton == null || submitting) return;
        int count = selectedKeys.size();
        submitButton.setText(count == 0
            ? "項目を選択してください"
            : count + "件を" + (MODE_RESTORE.equals(mode) ? "販売再開" : "欠品登録"));
        submitButton.setEnabled(count > 0);
        submitButton.setAlpha(count > 0 ? 1f : 0.45f);
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
        @Override public int getCount() { return visibleItems.size(); }
        @Override public Object getItem(int position) { return visibleItems.get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            RowHolder holder;
            if (convertView == null) {
                LinearLayout row = new LinearLayout(QuickInventoryActivity.this);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setPadding(dp(4), dp(8), dp(4), dp(8));
                CheckBox check = new CheckBox(QuickInventoryActivity.this);
                check.setClickable(false);
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
                holder = new RowHolder(check, label, meta);
                row.setTag(holder);
                convertView = row;
            } else {
                holder = (RowHolder) convertView.getTag();
            }
            InventoryItem item = visibleItems.get(position);
            holder.check.setChecked(selectedKeys.contains(item.key));
            holder.label.setText(item.label);
            holder.meta.setText("item".equals(item.kind) ? "商品" : "食材・選択肢");
            return convertView;
        }
    }

    private static final class RowHolder {
        final CheckBox check;
        final TextView label;
        final TextView meta;

        RowHolder(CheckBox check, TextView label, TextView meta) {
            this.check = check;
            this.label = label;
            this.meta = meta;
        }
    }
}
