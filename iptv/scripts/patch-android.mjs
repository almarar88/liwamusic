/**
 * LiwaIPTV — تهيئة مشروع أندرويد بعد `cap add android`:
 *  • السماح ببث HTTP (أغلب خوادم IPTV بلا HTTPS)، وصورة داخل صورة، وأندرويد TV.
 *  • LiwaWebViewClient: وسيط يمرّر طلبات البث عبر أندرويد مباشرة فيتخطى قيود CORS،
 *    ويضيف User-Agent/Referer لكل مضيف، ويتبع التحويلات ويعيد كتابة روابط m3u8 النسبية.
 *  • إضافة LiwaNative: إبقاء الشاشة مضاءة، ملء الشاشة، الاتجاه، السطوع، الصوت،
 *    صورة داخل صورة، الفتح بمشغل خارجي، وكشف التلفاز.
 * يُشغَّل في سير العمل الآلي، وهو مُتسامح: لا يفشل إن كان التعديل مطبَّقًا.
 */
import fs from 'node:fs';
import path from 'node:path';

const ANDROID = process.argv[2] || 'android';
const PKG = 'com.liwaiptv.app';
const JAVA_DIR = path.join(ANDROID, 'app/src/main/java', ...PKG.split('.'));

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); console.log('✓', path.relative('.', p)); }

// ———————————————————————————— 1) المانيفست

const manifestPath = path.join(ANDROID, 'app/src/main/AndroidManifest.xml');
let manifest = read(manifestPath);
const appAttrs = {
  'android:usesCleartextTraffic': 'true',
  'android:banner': '@drawable/banner',
  'android:largeHeap': 'true',
};
for (const [k, v] of Object.entries(appAttrs)) {
  if (!manifest.includes(k)) manifest = manifest.replace(/<application\b/, `<application\n        ${k}="${v}"`);
}
const actAttrs = {
  'android:supportsPictureInPicture': 'true',
  'android:resizeableActivity': 'true',
  'android:screenOrientation': 'unspecified',
};
for (const [k, v] of Object.entries(actAttrs)) {
  if (!manifest.includes(k)) manifest = manifest.replace(/<activity\b/, `<activity\n            ${k}="${v}"`);
}
// configChanges: لا نعيد إنشاء النشاط عند الدوران أو الدخول لوضع صورة داخل صورة
manifest = manifest.replace(/android:configChanges="([^"]*)"/, (m, v) => {
  const need = ['orientation', 'keyboardHidden', 'keyboard', 'screenSize', 'smallestScreenSize', 'screenLayout', 'uiMode', 'navigation', 'density'];
  const set = new Set(v.split('|').filter(Boolean));
  need.forEach((n) => set.add(n));
  return `android:configChanges="${[...set].join('|')}"`;
});
// أندرويد TV: الظهور في مشغّل التلفاز
if (!manifest.includes('LEANBACK_LAUNCHER')) {
  manifest = manifest.replace(
    /(<category android:name="android.intent.category.LAUNCHER" \/>)/,
    '$1\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />',
  );
}
if (!manifest.includes('android.software.leanback')) {
  manifest = manifest.replace(/<application\b/, `<uses-feature android:name="android.software.leanback" android:required="false" />
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application`);
}
// أندرويد 11+: رؤية مشغلات الفيديو المثبتة لفتح البث فيها
if (!manifest.includes('<queries>')) {
  manifest = manifest.replace(/<application\b/, `<queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="video/*" />
        </intent>
    </queries>

    <application`);
}
write(manifestPath, manifest);

// ———————————————————————————— 2) الكود الأصلي

write(path.join(JAVA_DIR, 'MainActivity.java'), `package ${PKG};

import android.content.res.Configuration;
import android.os.Bundle;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private WindowInfoTrackerCallbackAdapter foldTracker;
    private final Consumer<WindowLayoutInfo> foldListener = info -> LiwaNativePlugin.onLayout(this, info);

    @Override
    public void onStart() {
        super.onStart();
        // الهواتف القابلة للطي: موضع المفصّل ووضعية الطي (كتاب/طاولة)
        try {
            foldTracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(this));
            foldTracker.addWindowLayoutInfoListener(this, ContextCompat.getMainExecutor(this), foldListener);
        } catch (Throwable ignored) { }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (foldTracker != null) foldTracker.removeWindowLayoutInfoListener(foldListener);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LiwaNativePlugin.class);
        super.onCreate(savedInstanceState);
        // وسيط البث: يتخطى CORS ويضيف الترويسات المطلوبة للخوادم
        bridge.setWebViewClient(new LiwaWebViewClient(bridge));
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        LiwaNativePlugin.notifyPip(isInPictureInPictureMode);
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        LiwaNativePlugin.onLeaveHint(this);
    }
}
`);

write(path.join(JAVA_DIR, 'LiwaWebViewClient.java'), `package ${PKG};

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * يمرّر طلبات الشبكة الخارجية (غير الصور) عبر HttpURLConnection:
 * بلا قيود CORS، مع User-Agent/Referer مخصّص لكل مضيف، واتباع التحويلات
 * (بما فيها http↔https)، وإعادة كتابة روابط قوائم m3u8 النسبية بعد التحويل.
 */
public class LiwaWebViewClient extends BridgeWebViewClient {
    public static final Map<String, String[]> RULES = new ConcurrentHashMap<>();
    public static volatile String DEFAULT_UA = null;

    private static final Pattern URI_ATTR = Pattern.compile("URI=\\"([^\\"]+)\\"");

    public LiwaWebViewClient(Bridge bridge) { super(bridge); }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || !(scheme.equals("http") || scheme.equals("https"))
                || host.equals("localhost") || host.equals("127.0.0.1")) {
            return super.shouldInterceptRequest(view, request);
        }
        String method = request.getMethod();
        Map<String, String> reqHeaders = request.getRequestHeaders();
        String accept = header(reqHeaders, "Accept");
        if (accept != null && accept.startsWith("image/")) return null; // الصور تعمل بلا وسيط
        if ("OPTIONS".equalsIgnoreCase(method)) return preflight();
        if (!"GET".equalsIgnoreCase(method)) return null;
        try {
            return fetch(uri.toString(), reqHeaders);
        } catch (Exception e) {
            return error(502, "Bad Gateway");
        }
    }

    private static String header(Map<String, String> h, String name) {
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet()) if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
        return null;
    }

    private WebResourceResponse fetch(String url, Map<String, String> reqHeaders) throws IOException {
        HttpURLConnection conn = null;
        String current = url;
        for (int hop = 0; hop < 8; hop++) {
            URL u = new URL(current);
            conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod("GET");
            if (reqHeaders != null) {
                for (Map.Entry<String, String> e : reqHeaders.entrySet()) {
                    String k = e.getKey().toLowerCase(Locale.ROOT);
                    if (k.equals("origin") || k.equals("accept-encoding") || k.equals("host") || k.equals("referer") || k.equals("cookie")) continue;
                    conn.setRequestProperty(e.getKey(), e.getValue());
                }
            }
            conn.setRequestProperty("Accept-Encoding", "identity");
            String[] rule = RULES.get(u.getAuthority());
            if (rule == null) rule = RULES.get(u.getHost());
            String[] any = RULES.get("*");
            if (rule == null) rule = any;
            else if (any != null && (rule[0] == null || rule[0].isEmpty())) rule = new String[] { any[0], rule[1] };
            String ua = rule != null && rule[0] != null && !rule[0].isEmpty() ? rule[0] : DEFAULT_UA;
            if (ua != null) conn.setRequestProperty("User-Agent", ua);
            if (rule != null && rule[1] != null && !rule[1].isEmpty()) conn.setRequestProperty("Referer", rule[1]);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400 && code != 304) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) return error(502, "Bad Redirect");
                current = new URL(u, loc).toString();
                continue;
            }
            break;
        }
        if (conn == null) return error(502, "Bad Gateway");
        int code = conn.getResponseCode();
        String type = conn.getContentType();
        String mime = "application/octet-stream";
        String charset = null;
        if (type != null) {
            String[] parts = type.split(";");
            mime = parts[0].trim();
            for (String p : parts) {
                String t = p.trim();
                if (t.toLowerCase(Locale.ROOT).startsWith("charset=")) charset = t.substring(8);
            }
        }
        Map<String, String> out = new HashMap<>();
        for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
            String k = e.getKey();
            if (k == null || e.getValue() == null || e.getValue().isEmpty()) continue;
            String lk = k.toLowerCase(Locale.ROOT);
            if (lk.startsWith("access-control-") || lk.equals("content-encoding") || lk.equals("transfer-encoding")
                    || lk.equals("connection") || lk.equals("set-cookie") || lk.equals("content-type")) continue;
            out.put(k, e.getValue().get(0));
        }
        out.put("Access-Control-Allow-Origin", "*");
        out.put("Access-Control-Expose-Headers", "*");
        InputStream body;
        try { body = conn.getInputStream(); } catch (IOException e) { body = conn.getErrorStream(); }
        if (body == null) body = new ByteArrayInputStream(new byte[0]);
        // قوائم HLS بعد التحويل: الروابط النسبية يجب أن تُحلّ نسبةً للعنوان النهائي
        String finalUrl = conn.getURL().toString();
        boolean playlist = mime.contains("mpegurl") || finalUrl.toLowerCase(Locale.ROOT).contains(".m3u8");
        if (playlist && code < 400 && !finalUrl.equals(url)) {
            byte[] raw = readAll(body);
            String text = new String(raw, StandardCharsets.UTF_8);
            if (text.startsWith("#EXTM3U")) {
                text = absolutize(text, new URL(finalUrl));
                raw = text.getBytes(StandardCharsets.UTF_8);
                out.remove("Content-Length");
                out.remove("content-length");
            }
            body = new ByteArrayInputStream(raw);
        }
        String reason = conn.getResponseMessage();
        if (reason == null || reason.isEmpty()) reason = code < 400 ? "OK" : "Error";
        if (code >= 300 && code < 400) code = 502;
        return new WebResourceResponse(mime, charset, code, reason, out, body);
    }

    static String absolutize(String text, URL base) {
        StringBuilder sb = new StringBuilder(text.length() + 256);
        for (String line : text.split("\\r?\\n")) {
            String t = line.trim();
            if (t.isEmpty()) { sb.append('\\n'); continue; }
            if (t.startsWith("#")) {
                Matcher m = URI_ATTR.matcher(t);
                StringBuffer b = new StringBuffer();
                while (m.find()) m.appendReplacement(b, Matcher.quoteReplacement("URI=\\"" + resolve(base, m.group(1)) + "\\""));
                m.appendTail(b);
                sb.append(b).append('\\n');
            } else {
                sb.append(resolve(base, t)).append('\\n');
            }
        }
        return sb.toString();
    }

    private static String resolve(URL base, String ref) {
        try { return new URL(base, ref).toString(); } catch (Exception e) { return ref; }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return bos.toByteArray();
    }

    private static WebResourceResponse preflight() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        h.put("Access-Control-Allow-Headers", "*");
        h.put("Access-Control-Max-Age", "86400");
        return new WebResourceResponse("text/plain", "utf-8", 200, "OK", h, new ByteArrayInputStream(new byte[0]));
    }

    private static WebResourceResponse error(int code, String reason) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", code, reason, h, new ByteArrayInputStream(new byte[0]));
    }
}
`);

write(path.join(JAVA_DIR, 'LiwaNativePlugin.java'), `package ${PKG};

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.app.UiModeManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.graphics.Rect;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowLayoutInfo;
import org.json.JSONObject;

@CapacitorPlugin(name = "LiwaNative")
public class LiwaNativePlugin extends Plugin {
    private static LiwaNativePlugin instance;
    private static volatile boolean playing = false;
    private static volatile Rational aspect = new Rational(16, 9);

    private static volatile JSObject lastFold = null;

    @Override
    public void load() { instance = this; }

    /** يحوّل معلومات الطي إلى إحداثيات CSS ويبلغ الواجهة. */
    static void onLayout(Activity a, WindowLayoutInfo info) {
        JSObject o = new JSObject();
        o.put("state", "none");
        float d = a.getResources().getDisplayMetrics().density;
        for (DisplayFeature f : info.getDisplayFeatures()) {
            if (!(f instanceof FoldingFeature)) continue;
            FoldingFeature ff = (FoldingFeature) f;
            Rect r = ff.getBounds();
            o.put("state", ff.getState() == FoldingFeature.State.HALF_OPENED ? "half" : "flat");
            o.put("orientation", ff.getOrientation() == FoldingFeature.Orientation.HORIZONTAL ? "h" : "v");
            o.put("separating", ff.isSeparating());
            o.put("x", Math.round(r.left / d));
            o.put("y", Math.round(r.top / d));
            o.put("w", Math.round(r.width() / d));
            o.put("h", Math.round(r.height() / d));
            break;
        }
        lastFold = o;
        if (instance != null) instance.notifyListeners("fold", o);
    }

    @PluginMethod
    public void getFold(PluginCall call) {
        call.resolve(lastFold != null ? lastFold : new JSObject());
    }

    static void notifyPip(boolean active) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("active", active);
        instance.notifyListeners("pip", o);
    }

    /** عند الخروج من التطبيق أثناء التشغيل ننتقل تلقائيًا لصورة داخل صورة. */
    static void onLeaveHint(Activity a) {
        if (!playing || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try { a.enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(aspect).build()); } catch (Exception ignored) { }
    }

    @PluginMethod
    public void setProxyRules(PluginCall call) {
        JSArray rules = call.getArray("rules");
        try {
            for (int i = 0; rules != null && i < rules.length(); i++) {
                JSONObject r = rules.getJSONObject(i);
                String host = r.optString("host", "");
                if (host.isEmpty()) continue;
                LiwaWebViewClient.RULES.put(host, new String[] { r.optString("ua", ""), r.optString("referer", "") });
            }
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        call.resolve();
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        playing = on;
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            if (on) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            if (on) {
                c.hide(WindowInsetsCompat.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode = call.getString("mode", "auto");
        int o;
        switch (mode) {
            case "landscape": o = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE; break;
            case "portrait": o = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT; break;
            default: o = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
        if (isTv()) o = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        final int fo = o;
        getActivity().runOnUiThread(() -> { getActivity().setRequestedOrientation(fo); call.resolve(); });
    }

    @PluginMethod
    public void setBrightness(PluginCall call) {
        double v = call.getDouble("value", -1.0);
        getActivity().runOnUiThread(() -> {
            WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
            lp.screenBrightness = v < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : (float) Math.max(0.01, Math.min(1.0, v));
            getActivity().getWindow().setAttributes(lp);
            call.resolve();
        });
    }

    @PluginMethod
    public void getVolume(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        JSObject o = new JSObject();
        o.put("value", max > 0 ? (double) am.getStreamVolume(AudioManager.STREAM_MUSIC) / max : 0);
        call.resolve(o);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        double v = call.getDouble("value", 0.5);
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        am.setStreamVolume(AudioManager.STREAM_MUSIC, (int) Math.round(Math.max(0, Math.min(1, v)) * max), 0);
        call.resolve();
    }

    @PluginMethod
    public void enterPip(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || !getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            call.reject("PiP غير مدعوم على هذا الجهاز");
            return;
        }
        int w = Math.max(1, call.getInt("w", 16));
        int h = Math.max(1, call.getInt("h", 9));
        double r = (double) w / h;
        if (r > 2.39) { w = 239; h = 100; } else if (r < 1 / 2.39) { w = 100; h = 239; }
        aspect = new Rational(w, h);
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(aspect).build());
                call.resolve();
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("no url"); return; }
        Intent i = new Intent(Intent.ACTION_VIEW);
        boolean web = url.contains("youtube.com/") || url.contains("youtu.be/");
        if (web) i.setData(Uri.parse(url));
        else i.setDataAndType(Uri.parse(url), "video/*");
        String title = call.getString("title");
        if (title != null) { i.putExtra("title", title); i.putExtra("android.intent.extra.TITLE", title); }
        String ua = call.getString("ua");
        if (ua != null && !ua.isEmpty()) {
            // VLC و MX Player يقرآن الترويسات بهذه الصيغ
            i.putExtra("headers", new String[] { "User-Agent", ua });
            Bundle b = new Bundle();
            b.putString("User-Agent", ua);
            i.putExtra("android.media.intent.extra.HTTP_HEADERS", b);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(web ? i : Intent.createChooser(i, "اختر مشغل الفيديو").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("لا يوجد مشغل فيديو خارجي — ثبّت VLC أو MX Player");
        }
    }

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject o = new JSObject();
        o.put("tv", isTv());
        o.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    private boolean isTv() {
        UiModeManager m = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        return (m != null && m.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
            || getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }
}
`);

// ———————————————————————————— 3) الاسم والألوان والإصدار

const stringsPath = path.join(ANDROID, 'app/src/main/res/values/strings.xml');
if (fs.existsSync(stringsPath)) {
  write(stringsPath, read(stringsPath)
    .replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">LiwaIPTV</string>')
    .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">LiwaIPTV</string>'));
}
const colorsPath = path.join(ANDROID, 'app/src/main/res/values/colors.xml');
if (fs.existsSync(colorsPath)) {
  write(colorsPath, read(colorsPath)
    .replace(/<color name="colorPrimary">[^<]*<\/color>/, '<color name="colorPrimary">#07080d</color>')
    .replace(/<color name="colorPrimaryDark">[^<]*<\/color>/, '<color name="colorPrimaryDark">#07080d</color>')
    .replace(/<color name="colorAccent">[^<]*<\/color>/, '<color name="colorAccent">#2ee6d6</color>'));
}
// الأيقونة التكيّفية الافتراضية تُستبدل بأيقوناتنا المرسومة
const anydpi = path.join(ANDROID, 'app/src/main/res/mipmap-anydpi-v26');
if (fs.existsSync(anydpi)) fs.rmSync(anydpi, { recursive: true, force: true });

const pkg = JSON.parse(read('package.json'));
const gradlePath = path.join(ANDROID, 'app/build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = read(gradlePath)
    .replace(/versionCode \d+/, `versionCode ${Number(process.env.VERSION_CODE || 1)}`)
    .replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
  if (!gradle.includes('androidx.core:core')) {
    gradle = gradle.replace(/dependencies \{/, 'dependencies {\n    implementation "androidx.core:core:$androidxCoreVersion"');
  }
  if (!gradle.includes('androidx.window:window')) {
    gradle = gradle.replace(/dependencies \{/, 'dependencies {\n    implementation "androidx.window:window:1.2.0"\n    implementation "androidx.window:window-java:1.2.0"');
  }
  write(gradlePath, gradle);
}

console.log('تمت تهيئة مشروع أندرويد لـ LiwaIPTV');
