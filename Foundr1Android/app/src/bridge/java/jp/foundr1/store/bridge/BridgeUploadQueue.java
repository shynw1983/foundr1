package jp.foundr1.store.bridge;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class BridgeUploadQueue extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "foundr1_bridge_uploads.db";
    private static final int DATABASE_VERSION = 1;
    private static final int MAX_PENDING = 500;
    private static final String KEY_MIGRATED = "upload_queue_sqlite_migrated";
    private static BridgeUploadQueue instance;

    static synchronized BridgeUploadQueue get(Context context) {
        if (instance == null) instance = new BridgeUploadQueue(context.getApplicationContext());
        return instance;
    }

    private BridgeUploadQueue(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
        migrateLegacyQueue(context);
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        database.execSQL(
            "create table pending_uploads ("
                + "id text primary key, kind text not null, body text not null, "
                + "created_at integer not null, attempts integer not null default 0)"
        );
        database.execSQL("create index idx_pending_uploads_created on pending_uploads(created_at)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
    }

    void enqueue(JSONObject body) {
        String id = body.optString("clientEventId");
        if (id.isEmpty()) {
            id = UUID.randomUUID().toString();
            try { body.put("clientEventId", id); } catch (Exception ignored) {}
        }
        ContentValues values = new ContentValues();
        values.put("id", id);
        values.put("kind", body.optString("kind"));
        values.put("body", body.toString());
        values.put("created_at", body.optLong("capturedAt", System.currentTimeMillis()));
        getWritableDatabase().insertWithOnConflict(
            "pending_uploads",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        );
        trim();
    }

    List<Item> items() {
        List<Item> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query(
            "pending_uploads",
            new String[] { "id", "body", "attempts" },
            null,
            null,
            null,
            null,
            "created_at asc",
            String.valueOf(MAX_PENDING)
        )) {
            while (cursor.moveToNext()) {
                try {
                    result.add(new Item(cursor.getString(0), new JSONObject(cursor.getString(1)), cursor.getInt(2)));
                } catch (Exception ignored) {
                    delete(cursor.getString(0));
                }
            }
        }
        return result;
    }

    void delete(String id) {
        getWritableDatabase().delete("pending_uploads", "id = ?", new String[] { id });
    }

    void noteAttempt(String id) {
        getWritableDatabase().execSQL(
            "update pending_uploads set attempts = attempts + 1 where id = ?",
            new Object[] { id }
        );
    }

    int count() {
        try (Cursor cursor = getReadableDatabase().rawQuery("select count(*) from pending_uploads", null)) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    private void trim() {
        getWritableDatabase().execSQL(
            "delete from pending_uploads where id in ("
                + "select id from pending_uploads order by created_at desc limit -1 offset " + MAX_PENDING
                + ")"
        );
    }

    private void migrateLegacyQueue(Context context) {
        if (BridgeConfig.prefs(context).getBoolean(KEY_MIGRATED, false)) return;
        try {
            JSONArray legacy = new JSONArray(
                BridgeConfig.prefs(context).getString("pending_uploads", "[]")
            );
            for (int index = 0; index < legacy.length(); index += 1) {
                JSONObject body = legacy.optJSONObject(index);
                if (body != null) enqueue(body);
            }
        } catch (Exception ignored) {
        }
        BridgeConfig.prefs(context).edit()
            .remove("pending_uploads")
            .putBoolean(KEY_MIGRATED, true)
            .apply();
    }

    static final class Item {
        final String id;
        final JSONObject body;
        final int attempts;

        Item(String id, JSONObject body, int attempts) {
            this.id = id;
            this.body = body;
            this.attempts = attempts;
        }
    }
}
