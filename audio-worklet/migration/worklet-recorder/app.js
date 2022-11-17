// Copyright (c) 2022 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

"use strict";

import createLinkFromAudioBuffer from "./exporter.mjs";

const context = new AudioContext();

let isRecording = false;

// Wait for user interaction to initialize audio, as per specification.
document.addEventListener(
    "click",
    (element) => {
        init();
        document.querySelector("#click-to-start").remove();
    },
    { once: true }
);

/**
 * Defines overall audio chain and initializes all functionality.
 */
async function init() {
    if (context.state === "suspended") {
        await context.resume();
    }

    // Get user's microphone and connect it to the AudioContext.
    const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            latency: 0,
        },
    });

    const micSourceNode = context.createMediaStreamSource(micStream);

    // { numberOfChannels: 2, sampleRate: 48000, maxFrameCount: 480000 }
    const recordingProperties = {
        numberOfChannels: micSourceNode.channelCount,
        sampleRate: context.sampleRate,
        maxFrameCount: context.sampleRate * 10, // 10초
    };

    const recordingNode = await setupRecordingWorkletNode(recordingProperties);
    const monitorNode = context.createGain();

    // We can pass this port across the app
    // and let components handle their relevant messages
    // const visualizerCallback = setupVisualizers(recordingNode);
    const recordingCallback = handleRecording(recordingNode.port, recordingProperties);

    recordingNode.port.onmessage = (event) => {
        console.log("🎤", { message: event.data.message });
        recordingCallback(event);
    };

    micSourceNode.connect(recordingNode).connect(monitorNode).connect(context.destination);
}

/**
 * Creates ScriptProcessor to record and track microphone audio.
 * @param {object} recordingProperties
 * @param {number} properties.numberOfChannels
 * @param {number} properties.sampleRate
 * @param {number} properties.maxFrameCount
 * @return {AudioWorkletNode} Recording node related components for the app.
 */
async function setupRecordingWorkletNode(recordingProperties) {
    await context.audioWorklet.addModule("recording-processor.js");

    const WorkletRecordingNode = new AudioWorkletNode(context, "recording-processor", {
        processorOptions: recordingProperties,
    });

    return WorkletRecordingNode;
}

/**
 * Set events and define callbacks for recording start/stop events.
 * @param {MessagePort} processorPort
 *     Processor port to send recording state events to
 * @param {object} recordingProperties Microphone channel count,
 *     for accurate recording length calculations.
 * @param {number} properties.numberOfChannels
 * @param {number} properties.sampleRate
 * @param {number} properties.maxFrameCount
 * @return {function} Callback for recording-related events.
 */
function handleRecording(processorPort, recordingProperties) {
    const recordButton = document.querySelector("#record");
    const recordText = recordButton.querySelector("span");
    const player = document.querySelector("#player");

    let recordingLength = 0;

    // If the max length is reached, we can no longer record.
    const recordingEventCallback = async (event) => {
        if (event.data.message === "MAX_RECORDING_LENGTH_REACHED") {
            isRecording = false;
            recordText.innerHTML = "Start";
            recordButton.setAttribute.disabled = true;
        }
        if (event.data.message === "UPDATE_RECORDING_LENGTH") {
            recordingLength = event.data.recordingLength;

            document.querySelector("#data-len").innerHTML =
                Math.round((recordingLength / context.sampleRate) * 100) / 100;
        }
        if (event.data.message === "SHARE_RECORDING_BUFFER") {
            const recordingBuffer = context.createBuffer(
                recordingProperties.numberOfChannels,
                recordingLength,
                context.sampleRate
            );

            for (let i = 0; i < recordingProperties.numberOfChannels; i++) {
                recordingBuffer.copyToChannel(event.data.buffer[i], i, 0);
            }

            const wavUrl = createLinkFromAudioBuffer(recordingBuffer, true);

            player.src = wavUrl;
        }
    };

    recordButton.addEventListener("click", (e) => {
        isRecording = !isRecording;

        // Inform processor that recording was paused.
        processorPort.postMessage({
            message: "UPDATE_RECORDING_STATE",
            setRecording: isRecording,
        });

        recordText.innerHTML = isRecording ? "Stop" : "Start";
    });

    return recordingEventCallback;
}