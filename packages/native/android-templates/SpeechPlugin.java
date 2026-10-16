package __PACKAGE__;

// `PotyroSpeech`: voice input in the Android app — docs/29 §2.
//
// Android's System WebView has no SpeechRecognition, so the shell asks this plugin instead. It uses
// the phone's own recognizer, privacy first:
//   - on Android 12+ (API 31), when the on-device recognizer exists for the language,
//     `SpeechRecognizer.createOnDeviceSpeechRecognizer` — nothing leaves the phone ("onDevice": true);
//   - otherwise the system recognizer (usually Google's), asked to prefer the offline model
//     (`EXTRA_PREFER_OFFLINE`), which it may ignore — the consent words say Google's servers then.
// RECORD_AUDIO is asked at runtime, here, the first time an app or the Studio listens; it is declared
// in the manifest by scripts/patch-manifest.mjs (voice only — the live camera never asks for audio).
//
// One utterance per listening: the recognizer ends after a pause, as on every Android keyboard.
// Copied into the generated project by scripts/patch-android.mjs, which registers it in MainActivity.

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

@CapacitorPlugin(name = "PotyroSpeech", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class SpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall starting;
    private boolean ended = true;
    private Runnable limit;

    private static boolean onDeviceAvailable(android.content.Context c) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(c);
    }

    @PluginMethod
    public void available(PluginCall call) {
        android.content.Context c = getContext();
        boolean onDevice = onDeviceAvailable(c);
        JSObject r = new JSObject();
        r.put("available", onDevice || SpeechRecognizer.isRecognitionAvailable(c));
        r.put("onDevice", onDevice);
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneAnswered");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void microphoneAnswered(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("The microphone is blocked for Potyro", "denied");
    }

    private void begin(PluginCall call) {
        final String language = call.getString("language", "en-US");
        final boolean partial = Boolean.TRUE.equals(call.getBoolean("partial", true));
        final int maxMs = call.getInt("maxMs", 300_000);
        main.post(() -> {
            finish(null, null, true); // one listening at a time: the last one ends
            android.content.Context c = getContext();
            boolean onDevice = onDeviceAvailable(c);
            if (!onDevice && !SpeechRecognizer.isRecognitionAvailable(c)) {
                call.reject("This phone has no speech recognizer", "unavailable");
                return;
            }
            recognizer = onDevice ? SpeechRecognizer.createOnDeviceSpeechRecognizer(c) : SpeechRecognizer.createSpeechRecognizer(c);
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            starting = call;
            ended = false;
            recognizer.setRecognitionListener(new Listener());
            recognizer.startListening(intent);
            limit = () -> {
                if (recognizer != null) recognizer.stopListening();
            };
            main.postDelayed(limit, maxMs);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            if (recognizer != null) recognizer.stopListening();
            else finish(null, null, false);
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            finish(null, null, true);
            call.resolve();
        });
    }

    /** End the listening once: tell the page, and let the recognizer go. */
    private void finish(String code, String message, boolean cancel) {
        if (limit != null) main.removeCallbacks(limit);
        limit = null;
        if (recognizer != null) {
            if (cancel) recognizer.cancel();
            recognizer.destroy();
            recognizer = null;
        }
        if (starting != null) {
            starting.reject(message != null ? message : "the microphone did not start", code != null ? code : "failed");
            starting = null;
            ended = true;
            return;
        }
        if (ended) return;
        ended = true;
        JSObject e = new JSObject();
        if (code != null) {
            e.put("code", code);
            e.put("message", message);
        }
        notifyListeners("end", e);
    }

    private static String first(Bundle b) {
        if (b == null) return null;
        ArrayList<String> m = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return m == null || m.isEmpty() ? null : m.get(0);
    }

    private static String codeOf(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "denied";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "offline";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
            case SpeechRecognizer.ERROR_AUDIO:
                return "unavailable";
            default:
                return "failed";
        }
    }

    private class Listener implements RecognitionListener {
        @Override
        public void onReadyForSpeech(Bundle params) {
            if (starting != null) {
                starting.resolve();
                starting = null;
            }
        }

        @Override
        public void onPartialResults(Bundle b) {
            String t = first(b);
            if (t == null) return;
            JSObject e = new JSObject();
            e.put("text", t);
            notifyListeners("partial", e);
        }

        @Override
        public void onResults(Bundle b) {
            String t = first(b);
            if (t != null && !t.isEmpty()) {
                JSObject e = new JSObject();
                e.put("text", t);
                notifyListeners("final", e);
            }
            finish(null, null, false);
        }

        @Override
        public void onError(int error) {
            // A pause with nothing said is an end, not a failure.
            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) finish(null, null, false);
            else finish(codeOf(error), "speech recognizer error " + error, false);
        }

        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}
    }
}
