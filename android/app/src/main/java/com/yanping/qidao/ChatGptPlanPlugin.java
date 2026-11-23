package com.yanping.qidao;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.math.BigInteger;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "ChatGptPlan")
public class ChatGptPlanPlugin extends Plugin {
    private static final String AUTH = "https://auth.openai.com";
    private static final String API = "https://api.openai.com/v1";
    private static final String TOKEN = AUTH + "/api/accounts/oauth/token";
    private static final String GRANT = "chatgpt.tokens.use.direct";
    private static final String SCOPE = "openid profile email offline_access resource.invoke " + GRANT;
    private static final String ALIAS = "yisle-chatgpt-plan";
    private static final String CALLBACK = "/auth/callback";
    private final ExecutorService accountWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService responses = Executors.newFixedThreadPool(3);
    private final ConcurrentHashMap<String, Inference> requests = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile ServerSocket listener;

    private static final class Inference {
        volatile boolean cancelled;
        volatile HttpsURLConnection connection;
        void cancel() {
            cancelled = true;
            if (connection != null) connection.disconnect();
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        accountWorker.execute(() -> {
            try { call.resolve(statusOf(readSession())); }
            catch (Exception e) { call.reject("无法读取手机上的 ChatGPT 授权"); }
        });
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        synchronized (this) {
            if (listener != null) { call.reject("请先完成浏览器中打开的 ChatGPT 授权"); return; }
            try {
                listener = new ServerSocket();
                listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            } catch (IOException e) {
                closeListener();
                call.reject("无法启动本机授权回调");
                return;
            }
        }
        ServerSocket socket = listener;
        accountWorker.execute(() -> {
            try { call.resolve(authorize(socket, Boolean.TRUE.equals(call.getBoolean("replaceAccount", false)))); }
            catch (SocketTimeoutException e) { call.reject("ChatGPT 授权超时，请重试"); }
            catch (Exception e) { call.reject(e instanceof PlanError ? e.getMessage() : "ChatGPT 授权失败，请重试"); }
            finally { closeListener(); }
        });
    }

    private JSObject authorize(ServerSocket socket, boolean replaceAccount) throws Exception {
        JSONObject existing = readSession();
        JSONObject previous = existing.optJSONObject("active");
        if (previous == null && !replaceAccount) previous = existing.optJSONObject("registration");
        String client = previous == null ? "dynamic_agent_client" : previous.getString("client_id");
        String state = randomValue(), nonce = randomValue(), verifier = randomValue();
        String redirect = "http://127.0.0.1:" + socket.getLocalPort() + CALLBACK;
        Uri.Builder url = Uri.parse(AUTH + "/api/accounts/authorize").buildUpon()
            .appendQueryParameter("client_id", client)
            .appendQueryParameter("ext_agent_host_id", hostId(existing))
            .appendQueryParameter("redirect_uri", redirect)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("resource", API)
            .appendQueryParameter("scope", SCOPE)
            .appendQueryParameter("state", state)
            .appendQueryParameter("nonce", nonce)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", b64(MessageDigest.getInstance("SHA-256").digest(bytes(verifier))));
        if (previous == null) url.appendQueryParameter("agent_name_hint", "Yisle");
        else {
            if (!previous.optString("id_token").isEmpty()) url.appendQueryParameter("id_token_hint", previous.getString("id_token"));
            if (!previous.optString("email").isEmpty()) url.appendQueryParameter("login_hint", previous.getString("email"));
            if (!previous.optBoolean("allowed")) url.appendQueryParameter("prompt", "consent");
        }
        Intent browser = new Intent(Intent.ACTION_VIEW, url.build());
        getActivity().startActivity(browser);
        Uri result = waitForCallback(socket, state);
        if (result.getQueryParameter("error") != null) throw new PlanError("ChatGPT 授权已取消或被拒绝");
        String issued = result.getQueryParameter("client_id");
        if (previous != null && issued == null) issued = client;
        if (issued == null || !issued.startsWith("oaiapp_") || (previous != null && !client.equals(issued))) {
            throw new PlanError("ChatGPT 未返回有效的客户端注册");
        }
        String code = result.getQueryParameter("code");
        if (code == null || code.isEmpty()) throw new PlanError("ChatGPT 未返回授权码");
        JSONObject grant = exchange(TOKEN, form("grant_type", "authorization_code", "client_id", issued,
            "code", code, "code_verifier", verifier, "redirect_uri", redirect, "resource", API), null);
        JSONObject identity = verifyIdentity(grant.getString("id_token"), issued, nonce);
        if (previous != null && !previous.getString("sub").equals(identity.getString("sub"))) {
            throw new PlanError("授权返回了另一个 ChatGPT 账号，请先断开当前账号");
        }
        JSONObject record = new JSONObject().put("client_id", issued).put("sub", identity.getString("sub"))
            .put("email", identity.optString("email")).put("id_token", grant.getString("id_token"));
        updateTokens(record, grant);
        existing.put("active", record);
        existing.put("registration", new JSONObject().put("client_id", issued)
            .put("sub", record.getString("sub")).put("email", record.getString("email")));
        saveSession(existing);
        return statusOf(existing);
    }

    private Uri waitForCallback(ServerSocket socket, String state) throws IOException {
        long deadline = android.os.SystemClock.elapsedRealtime() + 180_000;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            socket.setSoTimeout((int) Math.max(1, deadline - android.os.SystemClock.elapsedRealtime()));
            try (Socket incoming = socket.accept()) {
                incoming.setSoTimeout(1200);
                String start = readRequestLine(incoming.getInputStream());
                if (start == null || !start.startsWith("GET ")) continue;
                String target = start.split(" ", 3)[1];
                if (!target.startsWith(CALLBACK + "?")) continue;
                Uri result = Uri.parse(target);
                if (!state.equals(result.getQueryParameter("state"))) continue;
                byte[] body = bytes("You can return to Yisle to see your ChatGPT connection status.");
                incoming.getOutputStream().write(bytes("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                    + "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n"
                    + "Content-Length: " + body.length + "\r\n\r\n"));
                incoming.getOutputStream().write(body);
                return result;
            } catch (SocketTimeoutException e) {
                if (android.os.SystemClock.elapsedRealtime() >= deadline) throw e;
            }
        }
        throw new SocketTimeoutException();
    }

    private static String readRequestLine(InputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        for (int i = 0; i < 16_384; i++) {
            int next = input.read();
            if (next == -1 || next == '\n') return line.toString("UTF-8").trim();
            line.write(next);
        }
        return null;
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        accountWorker.execute(() -> {
            try {
                JSONObject session = readSession();
                JSONObject active = session.optJSONObject("active");
                for (Inference request : requests.values()) request.cancel();
                session.remove("active");
                saveSession(session);
                if (active != null && !active.optString("refresh_token").isEmpty()) {
                    try {
                        String endpoint = discovery().getString("revocation_endpoint");
                        exchange(endpoint, form("token", active.getString("refresh_token"),
                            "token_type_hint", "refresh_token", "client_id", active.getString("client_id")), null);
                    } catch (Exception e) {
                        call.resolve(new JSObject().put("revoked", false));
                        return;
                    }
                }
                call.resolve(new JSObject().put("revoked", true));
            } catch (Exception e) { call.reject("无法断开手机上的 ChatGPT 授权"); }
        });
    }

    @PluginMethod
    public void models(PluginCall call) {
        accountWorker.execute(() -> {
            try {
                JSONArray catalog = exchange(API + "/models", null, accessToken()).getJSONArray("models");
                JSONArray listed = new JSONArray();
                for (int i = 0; i < catalog.length(); i++) {
                    JSONObject model = catalog.getJSONObject(i);
                    if (!"list".equals(model.optString("visibility")) || model.optString("slug").isEmpty()) continue;
                    listed.put(new JSONObject().put("id", model.getString("slug"))
                        .put("label", model.optString("display_name", model.getString("slug"))));
                }
                call.resolve(new JSObject().put("models", listed));
            } catch (Exception e) { call.reject(e instanceof PlanError ? e.getMessage() : "无法获取 ChatGPT 模型列表"); }
        });
    }

    @PluginMethod
    public void stream(PluginCall call) {
        String id = call.getString("id", "");
        String model = call.getString("model", "");
        JSONArray input = call.getArray("input");
        if (id.isEmpty() || model.isEmpty() || input == null || input.length() == 0) {
            call.reject("缺少 ChatGPT 模型或消息"); return;
        }
        Inference request = new Inference();
        if (requests.size() >= 3 || requests.putIfAbsent(id, request) != null) {
            call.reject("ChatGPT 请求正在运行，请稍后再试"); return;
        }
        accountWorker.execute(() -> {
            if (request.cancelled) { requests.remove(id, request); call.resolve(); return; }
            try {
                String token = accessToken();
                responses.execute(() -> readResponse(call, id, model, input, token, request));
            } catch (Exception e) {
                requests.remove(id, request);
                call.reject(e instanceof PlanError ? e.getMessage() : "无法读取 ChatGPT 授权，请重新连接");
            }
        });
    }

    private void readResponse(PluginCall call, String id, String model, JSONArray input,
                              String token, Inference request) {
        HttpsURLConnection conn = null;
        try {
            if (request.cancelled) { call.resolve(); return; }
            conn = connection(API + "/responses");
            request.connection = conn;
            if (request.cancelled) { call.resolve(); return; }
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "text/event-stream");
            writeBody(conn, "application/json", new JSONObject().put("model", model).put("input", input)
                .put("store", false).put("stream", true).toString());
            requireSuccess(conn);
            boolean completed = false;
            try (BufferedReader lines = reader(conn.getInputStream())) {
                String line;
                while (!request.cancelled && (line = lines.readLine()) != null) {
                    if (!line.startsWith("data: ") || "data: [DONE]".equals(line)) continue;
                    JSONObject event = new JSONObject(line.substring(6));
                    String type = event.optString("type");
                    if ("response.output_text.delta".equals(type) || "response.refusal.delta".equals(type)) {
                        emit(id, new JSObject().put("text", event.optString("delta")));
                    } else if ("response.failed".equals(type) || "error".equals(type)) {
                        JSONObject response = event.optJSONObject("response");
                        JSONObject error = response == null ? event : response.optJSONObject("error");
                        throw upstreamError(error == null ? "" : error.optString("code"), 0);
                    } else if ("response.incomplete".equals(type)) {
                        throw new PlanError("ChatGPT 回复未完成");
                    } else if ("response.completed".equals(type)) {
                        JSONObject response = event.getJSONObject("response");
                        JSONObject usage = response.optJSONObject("usage");
                        if (usage != null) emit(id, new JSObject().put("usage", usage));
                        completed = true;
                        break;
                    }
                }
            }
            if (!completed && !request.cancelled) throw new PlanError("ChatGPT 回复流提前断开");
            main.post(call::resolve);
        } catch (Exception e) {
            main.post(() -> {
                if (request.cancelled) call.resolve();
                else call.reject(e instanceof PlanError ? e.getMessage() : "ChatGPT 回复连接中断");
            });
        } finally {
            if (conn != null) conn.disconnect();
            requests.remove(id, request);
        }
    }

    private void emit(String id, JSObject event) {
        event.put("id", id);
        main.post(() -> notifyListeners("response", event));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Inference request = requests.get(call.getString("id", ""));
        if (request != null) request.cancel();
        call.resolve();
    }

    private String accessToken() throws Exception {
        JSONObject session = readSession();
        JSONObject active = session.optJSONObject("active");
        if (active == null || !active.optBoolean("allowed")) throw new PlanError("请先连接 ChatGPT 并授权使用订阅额度");
        if (active.optLong("expiry") > System.currentTimeMillis() + 60_000) return active.getString("access_token");
        if (active.optString("refresh_token").isEmpty()) throw new PlanError("ChatGPT 授权已过期，请重新连接");
        JSONObject renewed = exchange(TOKEN, form("grant_type", "refresh_token",
            "client_id", active.getString("client_id"), "refresh_token", active.getString("refresh_token"), "resource", API), null);
        updateTokens(active, renewed);
        saveSession(session);
        if (!active.optBoolean("allowed")) throw new PlanError("ChatGPT 订阅授权已关闭，请重新连接");
        return active.getString("access_token");
    }

    private static void updateTokens(JSONObject record, JSONObject tokens) throws Exception {
        record.put("access_token", tokens.getString("access_token"));
        record.put("refresh_token", tokens.optString("refresh_token", record.optString("refresh_token")));
        record.put("expiry", System.currentTimeMillis() + 1000L * tokens.getLong("expires_in"));
        if (tokens.has("scope") || !record.has("allowed")) {
            record.put("allowed", Arrays.asList(tokens.optString("scope").split("\\s+")).contains(GRANT));
        }
    }

    private static JSObject statusOf(JSONObject session) {
        JSONObject active = session.optJSONObject("active");
        return new JSObject().put("connected", active != null)
            .put("allowed", active != null && active.optBoolean("allowed"))
            .put("email", active == null ? "" : active.optString("email"))
            .put("hasRegistration", session.has("registration"));
    }

    private String hostId(JSONObject session) throws Exception {
        if (!session.has("host")) {
            session.put("host", "urn:uuid:" + UUID.randomUUID());
            saveSession(session);
        }
        return session.getString("host");
    }

    private static JSONObject discovery() throws Exception {
        return exchange(AUTH + "/.well-known/openid-configuration", null, null);
    }

    private static JSONObject verifyIdentity(String token, String client, String nonce) throws Exception {
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3) throw new PlanError("ChatGPT 返回了无效的身份令牌");
        JSONObject header = new JSONObject(new String(decode(parts[0]), StandardCharsets.UTF_8));
        if (!"RS256".equals(header.optString("alg"))) throw new PlanError("ChatGPT 身份签名算法不受支持");
        JSONArray keys = exchange(discovery().getString("jwks_uri"), null, null).getJSONArray("keys");
        boolean verified = false;
        for (int i = 0; i < keys.length(); i++) {
            JSONObject key = keys.getJSONObject(i);
            if (!header.getString("kid").equals(key.optString("kid")) || !"RSA".equals(key.optString("kty"))) continue;
            RSAPublicKeySpec spec = new RSAPublicKeySpec(new BigInteger(1, decode(key.getString("n"))),
                new BigInteger(1, decode(key.getString("e"))));
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(spec));
            signature.update(bytes(parts[0] + "." + parts[1]));
            verified = signature.verify(decode(parts[2]));
            break;
        }
        JSONObject identity = new JSONObject(new String(decode(parts[1]), StandardCharsets.UTF_8));
        JSONArray audiences = identity.optJSONArray("aud");
        boolean audienceOk = client.equals(identity.optString("aud"));
        if (audiences != null) {
            for (int i = 0; i < audiences.length(); i++) audienceOk |= client.equals(audiences.optString(i));
            if (audiences.length() > 1) audienceOk &= client.equals(identity.optString("azp"));
        }
        if (!verified || !AUTH.equals(identity.optString("iss")) || !audienceOk
            || !nonce.equals(identity.optString("nonce")) || identity.optString("sub").isEmpty()
            || identity.optLong("exp") <= System.currentTimeMillis() / 1000) {
            throw new PlanError("ChatGPT 身份验证失败");
        }
        return identity;
    }

    private AtomicFile credentials() {
        return new AtomicFile(new File(getContext().getNoBackupFilesDir(), "chatgpt-plan"));
    }

    private JSONObject readSession() throws Exception {
        AtomicFile file = credentials();
        if (!file.getBaseFile().exists() && !new File(file.getBaseFile().getPath() + ".bak").exists()) return new JSONObject();
        byte[] blob = file.readFully();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Arrays.copyOf(blob, 12)));
        return new JSONObject(new String(cipher.doFinal(blob, 12, blob.length - 12), StandardCharsets.UTF_8));
    }

    private void saveSession(JSONObject session) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        AtomicFile file = credentials();
        FileOutputStream output = file.startWrite();
        try {
            output.write(cipher.getIV());
            output.write(cipher.doFinal(bytes(session.toString())));
            file.finishWrite(output);
        } catch (Exception e) { file.failWrite(output); throw e; }
    }

    private static SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }

    private static JSONObject exchange(String address, String body, String token) throws Exception {
        HttpsURLConnection conn = connection(address);
        try {
            if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) writeBody(conn, "application/x-www-form-urlencoded", body);
            requireSuccess(conn);
            String data = readText(conn.getInputStream());
            return data.isEmpty() ? new JSONObject() : new JSONObject(data);
        } finally { conn.disconnect(); }
    }

    private static HttpsURLConnection connection(String address) throws Exception {
        URL url = new URL(address);
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null
            || !("auth.openai.com".equals(url.getHost()) || "api.openai.com".equals(url.getHost()))) {
            throw new IOException("Unexpected OpenAI endpoint");
        }
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(90_000);
        return conn;
    }

    private static void writeBody(HttpsURLConnection conn, String contentType, String body) throws IOException {
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", contentType);
        conn.setDoOutput(true);
        byte[] data = bytes(body);
        conn.setFixedLengthStreamingMode(data.length);
        try (java.io.OutputStream output = conn.getOutputStream()) { output.write(data); }
    }

    private static void requireSuccess(HttpsURLConnection conn) throws Exception {
        int status = conn.getResponseCode();
        if (status >= 200 && status < 300) return;
        String code = "";
        try {
            JSONObject data = new JSONObject(readText(conn.getErrorStream()));
            JSONObject error = data.optJSONObject("error");
            code = error == null ? data.optString("error") : error.optString("code");
        } catch (Exception ignored) {}
        throw upstreamError(code, status);
    }

    private static PlanError upstreamError(String code, int status) {
        if ("subscription_sharing_usage_limit_exceeded".equals(code) || status == 429)
            return new PlanError("ChatGPT 计划达到用量限制，请到 ChatGPT → 设置 → 用量查看");
        if ("subscription_sharing_user_not_eligible".equals(code))
            return new PlanError("这个 ChatGPT 账号或工作区当前不能使用订阅额度");
        if ("invalid_grant".equals(code) || status == 401) return new PlanError("ChatGPT 授权已失效，请重新连接");
        if (status == 403) return new PlanError("ChatGPT 拒绝了请求，请检查授权和所在地区");
        return new PlanError("ChatGPT 请求失败" + (status > 0 ? "（HTTP " + status + "）" : ""));
    }

    private static BufferedReader reader(InputStream input) {
        return new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
    }

    private static String readText(InputStream input) throws IOException {
        if (input == null) return "";
        StringBuilder text = new StringBuilder();
        try (BufferedReader reader = reader(input)) {
            char[] buffer = new char[4096];
            int length;
            while ((length = reader.read(buffer)) != -1) {
                if (text.length() + length > 1_048_576) throw new IOException("Response too large");
                text.append(buffer, 0, length);
            }
        }
        return text.toString();
    }

    private static String form(String... fields) {
        Uri.Builder builder = new Uri.Builder();
        for (int i = 0; i < fields.length; i += 2) builder.appendQueryParameter(fields[i], fields[i + 1]);
        return builder.build().getEncodedQuery();
    }

    private static byte[] bytes(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    private static String b64(byte[] bytes) { return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static byte[] decode(String s) { return Base64.decode(s, Base64.URL_SAFE | Base64.NO_WRAP); }
    private static String randomValue() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return b64(bytes);
    }

    private synchronized void closeListener() {
        if (listener == null) return;
        try { listener.close(); } catch (IOException ignored) {}
        listener = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeListener();
        for (Inference request : requests.values()) request.cancel();
        accountWorker.shutdownNow();
        responses.shutdownNow();
        super.handleOnDestroy();
    }

    private static final class PlanError extends IOException {
        PlanError(String message) { super(message); }
    }
}
