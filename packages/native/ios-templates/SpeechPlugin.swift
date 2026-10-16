// `PotyroSpeech` for iOS — the twin of android-templates/SpeechPlugin.java (docs/29 §2, docs/27 §4.7).
//
// NOT COMPILED YET: nothing here has run on a Mac. Until the iOS developer adds it (docs/27 §4.7),
// the app uses the WebView's own speech recognition, else the cloud fallback — `Capacitor.
// isPluginAvailable("PotyroSpeech")` decides (packages/native/src/capacitor-capabilities.ts).
//
// SFSpeechRecognizer, privacy first: `requiresOnDeviceRecognition` whenever the recognizer supports
// it for the language ("onDevice": true — nothing leaves the iPhone), else Apple's servers, which the
// consent words then name. Same JS contract as Android: available / start / stop / cancel, and the
// events "partial", "final", "end" ({ code?, message? }). Needs NSMicrophoneUsageDescription and
// NSSpeechRecognitionUsageDescription (scripts/patch-plist.mjs adds both).

import AVFoundation
import Capacitor
import Foundation
import Speech

@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechPlugin"
    public let jsName = "PotyroSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var ended = true
    private var limit: DispatchWorkItem?

    @objc func available(_ call: CAPPluginCall) {
        let r = SFSpeechRecognizer(locale: Locale(identifier: call.getString("language") ?? "en-US"))
        call.resolve(["available": r?.isAvailable ?? false, "onDevice": r?.supportsOnDeviceRecognition ?? false])
    }

    @objc func start(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else { return call.reject("Speech recognition is not allowed for Potyro", "denied") }
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard granted else { return call.reject("The microphone is blocked for Potyro", "denied") }
                    self.begin(call)
                }
            }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        finish(code: nil, message: nil, cancel: true)
        let language = call.getString("language") ?? "en-US"
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)), recognizer.isAvailable else {
            return call.reject("This iPhone cannot recognise \(language)", "unavailable")
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = call.getBool("partial") ?? true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let input = audio.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in req.append(buffer) }
            audio.prepare()
            try audio.start()
        } catch {
            return call.reject("The microphone did not start", "unavailable")
        }
        request = req
        ended = false
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                self.notifyListeners(result.isFinal ? "final" : "partial", data: ["text": text])
                if result.isFinal { self.finish(code: nil, message: nil, cancel: false) }
            } else if let error = error {
                let nsError = error as NSError
                // 1110: nothing was said — an end, not a failure.
                if nsError.code == 1110 { self.finish(code: nil, message: nil, cancel: false) }
                else { self.finish(code: "failed", message: error.localizedDescription, cancel: false) }
            }
        }
        let maxMs = call.getInt("maxMs") ?? 300_000
        let item = DispatchWorkItem { [weak self] in self?.request?.endAudio() }
        limit = item
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(maxMs), execute: item)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.audio.stop()
            self.audio.inputNode.removeTap(onBus: 0)
            self.request?.endAudio()
            call.resolve()
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finish(code: nil, message: nil, cancel: true)
            call.resolve()
        }
    }

    private func finish(code: String?, message: String?, cancel: Bool) {
        limit?.cancel()
        limit = nil
        if audio.isRunning {
            audio.stop()
            audio.inputNode.removeTap(onBus: 0)
        }
        if cancel { task?.cancel() }
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if ended { return }
        ended = true
        var e: [String: Any] = [:]
        if let code = code {
            e["code"] = code
            e["message"] = message ?? code
        }
        notifyListeners("end", data: e)
    }
}
