// Copyright (c) 2022 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class RecordingProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.sampleRate = 0;
        this.maxRecordingFrames = 0;
        this.numberOfChannels = 0;

        if (options && options.processorOptions) {
            const { numberOfChannels, sampleRate, maxFrameCount } = options.processorOptions;

            this.sampleRate = sampleRate;
            this.maxRecordingFrames = maxFrameCount;
            this.numberOfChannels = numberOfChannels;
        }

        this._recordingBuffer = new Array(this.numberOfChannels).fill(
            new Float32Array(this.maxRecordingFrames)
        );

        this.recordedFrames = 0;
        this.isRecording = false; // From app.js isRecording

        // We will use a timer to gate our messages; this one will publish at 60hz
        this.framesSinceLastPublish = 0;
        this.publishInterval = this.sampleRate / 60;

        // We will keep a live sum for rendering the visualizer.
        this.sampleSum = 0;

        this.port.onmessage = (event) => {
            console.log("π¨", { message: event.data.message });
            if (event.data.message === "UPDATE_RECORDING_STATE") {
                this.isRecording = event.data.setRecording;

                if (this.isRecording === false) {
                    this.port.postMessage({
                        message: "SHARE_RECORDING_BUFFER",
                        buffer: this._recordingBuffer,
                    });
                }
            }
        };
    }

    // [ app -> processor ] "UPDATE_RECORDING_STATE" : Start/Stop Recording λ²νΌμ λλ₯Ό λ
    // [ processor -> app ] "SHARE_RECORDING_BUFFER" : Stop Recording λλ¬μ <audio>μ λ²νΌκ° λ€μ΄κ° λ


    process(inputs, outputs, params) {
        for (let input = 0; input < 1; input++) {
            for (let channel = 0; channel < this.numberOfChannels; channel++) {
                for (let sample = 0; sample < inputs[input][channel].length; sample++) {
                    const currentSample = inputs[input][channel][sample];

                    // Copy data to recording buffer.
                    if (this.isRecording) {
                        this._recordingBuffer[channel][sample + this.recordedFrames] = currentSample;
                    }

                    // π·οΈ outuputμ Raw λ°μ΄ν°λ₯Ό λ£μΌλ©΄ λ°λ‘ μ€νΌμ»€λ‘ μΆλ ₯λλ€. (μ€μκ° μΆλ ₯)
                    // outputs[input][channel][sample] = currentSample;

                    // Sum values for visualizer
                    this.sampleSum += currentSample;
                }
            }
        }

        const shouldPublish = this.framesSinceLastPublish >= this.publishInterval;
        console.log({ shouldPublish, framesSinceLastPublish: this.framesSinceLastPublish, publishInterval: this.publishInterval });

        // Validate that recording hasn't reached its limit.
        if (this.isRecording) {
            if (this.recordedFrames + 128 < this.maxRecordingFrames) {
                this.recordedFrames += 128;

                // Post a recording recording length update on the clock's schedule
                if (shouldPublish) {
                    this.port.postMessage({
                        message: "UPDATE_RECORDING_LENGTH",
                        recordingLength: this.recordedFrames,
                    });
                }
            } else {
                // Let the rest of the app know the limit was reached.
                this.isRecording = false;
                this.port.postMessage({
                    message: "MAX_RECORDING_LENGTH_REACHED",
                });

                return false;
            }
        }

        // Handle message clock.
        // If we should publish, post message and reset clock.
        if (shouldPublish) {
            this.framesSinceLastPublish = 0;
            this.sampleSum = 0;
        } else {
            this.framesSinceLastPublish += 128;
        }

        return true;
    }
}

registerProcessor("recording-processor", RecordingProcessor);
