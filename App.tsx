import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState } from './types';
import { SYSTEM_INSTRUCTION } from './constants';
import { createBlob, decode, decodeAudioData } from './services/audioUtils';
import AudioOrb from './components/AudioOrb';

const API_KEY = process.env.API_KEY;

const endCallTool: FunctionDeclaration = {
  name: "endCall",
  description: "End the call/conversation immediately.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  }
};

export default function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [copied, setCopied] = useState(false);

  // Audio References
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Gemini Session Reference
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const aiClientRef = useRef<GoogleGenAI | null>(null);

  // Initialize Audio Contexts
  const initAudioContexts = () => {
    if (!inputAudioContextRef.current) {
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
    if (!outputAudioContextRef.current) {
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      // Create Analyser for Visualizer
      const analyser = outputAudioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      outputAnalyserRef.current = analyser;
    }
  };

  const stopAudio = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    // Stop all playing sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  const disconnectFromGemini = () => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current = null;
    }
    stopAudio();
    setConnectionState('disconnected');
  };

  const connectToGemini = async () => {
    if (!API_KEY) {
      setErrorMsg("API Key not found in environment.");
      return;
    }

    try {
      setConnectionState('connecting');
      setErrorMsg(null);
      initAudioContexts();

      // Resume contexts if suspended (browser autoplay policy)
      if (inputAudioContextRef.current?.state === 'suspended') await inputAudioContextRef.current.resume();
      if (outputAudioContextRef.current?.state === 'suspended') await outputAudioContextRef.current.resume();

      aiClientRef.current = new GoogleGenAI({ apiKey: API_KEY });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Connect to Gemini Live
      const sessionPromise = aiClientRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
          },
          tools: [{ functionDeclarations: [endCallTool] }]
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Connection Opened');
            setConnectionState('connected');

            // Setup Input Streaming
            if (!inputAudioContextRef.current) return;
            
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (isMuted) return; // Don't send data if muted locally
              
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch(err => console.error("Error sending audio:", err));
            };

            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             // Handle interruptions
             const interrupted = message.serverContent?.interrupted;
             if (interrupted) {
               console.log("Interrupted by server");
               sourcesRef.current.forEach(source => {
                 try { source.stop(); } catch(e) {}
               });
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
             }

             // Handle Tool Calls (e.g., Hang up)
             if (message.toolCall) {
                const calls = message.toolCall.functionCalls;
                if (calls && calls.length > 0) {
                   if (calls.some(c => c.name === 'endCall')) {
                      // Allow a few seconds for the "Goodbye" message to finish playing before cutting the connection
                      setTimeout(() => {
                        disconnectFromGemini();
                      }, 4000);
                   }
                   
                   // Send response back to acknowledge (even if ending)
                   sessionPromise.then(session => session.sendToolResponse({
                     functionResponses: calls.map(c => ({
                       id: c.id,
                       name: c.name,
                       response: { result: "ok" }
                     }))
                   }));
                }
             }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              const buffer = await decodeAudioData(
                decode(base64Audio),
                ctx,
                24000,
                1
              );

              // Schedule playback
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              
              // Connect to analyser for visualization, then to destination
              if (outputAnalyserRef.current) {
                source.connect(outputAnalyserRef.current);
                outputAnalyserRef.current.connect(ctx.destination);
              } else {
                source.connect(ctx.destination);
              }

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              
              sourcesRef.current.add(source);
              source.onended = () => {
                sourcesRef.current.delete(source);
              };
            }
          },
          onclose: (e) => {
            console.log('Gemini Live Connection Closed', e);
            setConnectionState('disconnected');
            stopAudio();
          },
          onerror: (e) => {
            console.error('Gemini Live Error', e);
            setConnectionState('error');
            setErrorMsg("Connection error occurred.");
            stopAudio();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (err: any) {
      console.error("Connection setup error:", err);
      setConnectionState('error');
      setErrorMsg(err.message || "Failed to access microphone or connect.");
      stopAudio();
    }
  };

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  const handleCopy = () => {
    // Generate iframe code based on current URL
    const code = `<iframe 
  src="${window.location.href}" 
  width="400" 
  height="600" 
  allow="microphone" 
  style="border: none; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.2);"
></iframe>`;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[url('https://images.unsplash.com/photo-1538481199705-c710c4e965fc?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-fixed bg-center relative flex flex-col">
       {/* Overlay */}
       <div className="absolute inset-0 bg-wick-black/90 backdrop-blur-sm z-0"></div>

       {/* Content */}
       <div className="relative z-10 container mx-auto px-4 flex-grow flex flex-col items-center justify-center">
          
          {/* Agent Card */}
          <div className="w-full max-w-lg bg-wick-dark/80 border border-gray-700 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden group">
             {/* Glow effect */}
             <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-wick-purple shadow-[0_0_20px_rgba(124,58,237,0.5)]"></div>

             <header className="flex items-center justify-between mb-8">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-wick-purple to-wick-cyan rounded-xl flex items-center justify-center shadow-lg shadow-wick-purple/20">
                     <span className="font-display font-bold text-white text-xl">CW</span>
                  </div>
                  <div>
                    <h1 className="font-display text-xl font-bold text-white tracking-wide">COMBO.WICK</h1>
                    <p className="text-[10px] text-wick-cyan tracking-[0.2em] uppercase font-bold">Support Agent</p>
                  </div>
               </div>
               <div className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
             </header>

             <div className="flex flex-col items-center mb-8">
                <AudioOrb state={connectionState} analyser={outputAnalyserRef.current} />
             </div>

             <div className="h-6 mb-8 text-center">
                 {connectionState === 'disconnected' && <p className="text-gray-500 text-sm font-medium">Ready to initialize</p>}
                 {connectionState === 'connecting' && <p className="text-wick-cyan text-sm animate-pulse font-mono">ESTABLISHING LINK...</p>}
                 {connectionState === 'connected' && <p className="text-green-400 text-sm font-mono tracking-widest">SYSTEM ONLINE</p>}
                 {connectionState === 'error' && <p className="text-red-400 text-sm font-mono">{errorMsg || "CONNECTION LOST"}</p>}
             </div>

             <div className="space-y-3">
               {connectionState === 'connected' ? (
                 <div className="flex gap-3">
                   <button 
                     onClick={toggleMute}
                     className={`flex-1 py-3 px-4 rounded-xl font-bold uppercase text-xs tracking-wider transition-all ${isMuted ? 'bg-red-500/10 text-red-400 border border-red-500/50' : 'bg-gray-800 text-white border border-gray-700 hover:bg-gray-700'}`}
                   >
                     {isMuted ? 'Unmute' : 'Mute'}
                   </button>
                   <button 
                     onClick={disconnectFromGemini}
                     className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold uppercase text-xs tracking-wider transition-all shadow-lg shadow-red-900/20"
                   >
                     Disconnect
                   </button>
                 </div>
               ) : (
                 <button 
                   onClick={connectToGemini}
                   className="w-full py-4 rounded-xl bg-gradient-to-r from-wick-purple to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold text-sm uppercase tracking-widest transition-all shadow-lg shadow-wick-purple/25 border border-white/10 group-hover:scale-[1.02]"
                 >
                   Initialize Agent
                 </button>
               )}
             </div>
          </div>

          <div className="mt-8 flex gap-4 text-sm text-gray-500">
             <button onClick={() => setShowDocs(true)} className="hover:text-wick-cyan transition-colors flex items-center gap-2">
               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
               Integration API
             </button>
          </div>
       </div>

       {/* API Docs Modal */}
       {showDocs && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => setShowDocs(false)}></div>
           <div className="relative bg-[#13131f] border border-gray-700 rounded-2xl p-8 max-w-2xl w-full shadow-2xl overflow-hidden animate-[pulse-fast_0.5s_ease-out]">
             
             <div className="flex justify-between items-start mb-6">
               <div>
                 <h2 className="font-display text-2xl font-bold text-white mb-2">Integration API</h2>
                 <p className="text-gray-400">Embed the COMBO.WICK Support Agent into your platform.</p>
               </div>
               <button onClick={() => setShowDocs(false)} className="text-gray-500 hover:text-white">
                 <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
             </div>

             <div className="bg-black/40 rounded-lg border border-gray-800 p-6 mb-6">
               <h3 className="text-sm font-bold text-wick-cyan uppercase tracking-wider mb-3">Quick Integration (Iframe)</h3>
               <p className="text-gray-400 text-sm mb-4">Add the following code to your HTML to render the agent widget. Ensure your site uses HTTPS for microphone permissions.</p>
               
               <div className="relative bg-gray-900 rounded border border-gray-800 p-4 font-mono text-xs text-gray-300 overflow-x-auto whitespace-pre">
{`<iframe 
  src="${window.location.href}" 
  width="400" 
  height="600" 
  allow="microphone" 
  style="border: none; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.2);"
></iframe>`}
                 <button 
                   onClick={handleCopy}
                   className="absolute top-2 right-2 p-2 bg-gray-800 hover:bg-gray-700 rounded text-white transition-colors"
                   title="Copy to clipboard"
                 >
                   {copied ? (
                     <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                   ) : (
                     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 012 2v8a2 2 0 01-2 2h-8a2 2 0 01-2-2v-8a2 2 0 012-2z" /></svg>
                   )}
                 </button>
               </div>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                  <h4 className="font-bold text-white text-sm mb-2">Requirements</h4>
                  <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                    <li>HTTPS connection</li>
                    <li>Microphone permission</li>
                    <li>Modern Browser</li>
                  </ul>
                </div>
                <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                  <h4 className="font-bold text-white text-sm mb-2">Capabilities</h4>
                  <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                    <li>Real-time Voice Support</li>
                    <li>Multi-language support</li>
                    <li>Instant Inventory Access</li>
                  </ul>
                </div>
             </div>
           </div>
         </div>
       )}
    </div>
  );
}