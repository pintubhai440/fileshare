import React, { useState, useEffect, useRef } from 'react';
import { Tab } from './types';
import { ChatBot } from './components/ChatBot';
import Peer, { DataConnection } from 'peerjs';

interface FileMeta {
  name: string;
  size: number;
  type: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.SEND);
  
  // PeerJS State
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Initializing...');
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  // Send State
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState<string>('0.0 MB/s');

  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);
  
  // High Performance Refs
  const bytesReceivedRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);
  const receivedFileMetaRef = useRef<FileMeta | null>(null);
  const writableStreamRef = useRef<any | null>(null); // For Direct Disk Writing

  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    const peer = new Peer(shortId, { 
        debug: 0, 
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
      setMyPeerId(id);
      setConnectionStatus('Ready to Connect');
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setConnectionStatus(`Connected to ${conn.peer}`);
      setupReceiverEvents(conn);
    });

    peerRef.current = peer;
    return () => { peer.destroy(); };
  }, []);

  // --- PROGRESS CALCULATOR ---
  const updateProgressUI = (currentBytes: number, totalSize: number) => {
    const now = Date.now();
    if (now - lastUpdateRef.current > 300) {
        const percent = Math.min(100, Math.round((currentBytes / totalSize) * 100));
        const bytesDiff = currentBytes - lastBytesRef.current;
        const timeDiff = (now - lastUpdateRef.current) / 1000;
        const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
        
        setTransferProgress(percent);
        setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
        
        lastUpdateRef.current = now;
        lastBytesRef.current = currentBytes;
    }
  };

  // --- RECEIVER LOGIC (Direct Disk Write) ---
  const setupReceiverEvents = (conn: DataConnection) => {
    conn.on('open', () => setConnectionStatus(`Connected securely to ${conn.peer}`));

    conn.on('data', async (data: any) => {
      const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array;

      // 1. Binary Data Handling (Writing to Disk)
      if (isBinary && writableStreamRef.current) {
        const buffer = data instanceof Uint8Array ? data.buffer : data;
        await writableStreamRef.current.write(buffer);
        
        bytesReceivedRef.current += buffer.byteLength;
        if (receivedFileMetaRef.current) {
            updateProgressUI(bytesReceivedRef.current, receivedFileMetaRef.current.size);
        }
      } 
      // 2. Metadata Handling
      else if (data.type === 'meta') {
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        
        bytesReceivedRef.current = 0;
        lastBytesRef.current = 0;
        lastUpdateRef.current = Date.now();
        
        setIsMotorReady(false);
        setIsTransferComplete(false);
        setTransferProgress(0);
        setTransferSpeed('Waiting for disk permission...');
      } 
      // 3. Transfer Ready Handshake (For Sender side)
      else if (data.type === 'ready_to_receive') {
        startPumping();
      }
      // 4. End of Transfer
      else if (data.type === 'end') {
        if (writableStreamRef.current) {
            await writableStreamRef.current.close();
            writableStreamRef.current = null;
        }
        setTransferProgress(100);
        setTransferSpeed('Completed');
        setIsTransferComplete(true);
      }
    });

    conn.on('close', () => {
      setConnectionStatus('Connection Closed');
      setTransferProgress(0);
    });
  };

  // --- PREPARE MOTOR (Confirm & Select Location) ---
  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) return;

    try {
        // @ts-ignore
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName: receivedFileMetaRef.current.name,
            });
            writableStreamRef.current = await handle.createWritable();
            setIsMotorReady(true);
            setTransferSpeed('Motor Ready ⚡');
            
            // Tell sender we are ready
            connRef.current.send({ type: 'ready_to_receive' });
        } else {
            alert("Your browser doesn't support Fast Mode. Please use Chrome or Edge.");
        }
    } catch (err) {
        console.error("User cancelled or error occurred", err);
    }
  };

  // --- SENDER LOGIC (Optimized Pumping) ---
  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current) return;
    setConnectionStatus(`Connecting...`);
    const conn = peerRef.current.connect(remotePeerId.toUpperCase(), { reliable: true });
    connRef.current = conn;
    setupReceiverEvents(conn);
  };

  const sendFile = () => {
    if (!connRef.current || !fileToSend) {
      alert("No connection or file!");
      return;
    }

    // Phase 1: Send Metadata
    connRef.current.send({
      type: 'meta',
      meta: { name: fileToSend.name, size: fileToSend.size, type: fileToSend.type }
    });
    setTransferSpeed('Waiting for receiver...');
  };

  const startPumping = () => {
    if (!fileToSend || !connRef.current) return;

    const conn = connRef.current;
    const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB Optimized Chunks
    const fileReader = new FileReader();
    let offset = 0;
    
    lastUpdateRef.current = Date.now();
    lastBytesRef.current = 0;

    fileReader.onload = (e) => {
      if (!e.target?.result) return;
      const buffer = e.target.result as ArrayBuffer;
      
      try {
        conn.send(buffer);
        offset += buffer.byteLength;
        updateProgressUI(offset, fileToSend.size);

        if (offset < fileToSend.size) {
           readNextChunk();
        } else {
           conn.send({ type: 'end' });
           setTransferProgress(100);
           setTransferSpeed('Sent Successfully');
        }
      } catch (err) {
        setTimeout(readNextChunk, 100);
      }
    };

    const readNextChunk = () => {
      // Flow Control: Don't overwhelm the buffer
      if (conn.dataChannel.bufferedAmount > 64 * 1024 * 1024) {
          setTimeout(readNextChunk, 50); 
          return;
      }
      const slice = fileToSend.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    readNextChunk();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]"></div>
      </div>

      <nav className="relative z-10 border-b border-white/10 backdrop-blur-md bg-gray-900/50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
           <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">SecureShare</span>
           <div className="text-xs bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
             Status: <span className="text-green-400">{connectionStatus}</span>
           </div>
        </div>
      </nav>

      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center">
        
        <div className="bg-gray-800 p-1 rounded-xl inline-flex mb-8 shadow-lg border border-gray-700">
          <button onClick={() => setActiveTab(Tab.SEND)} className={`px-8 py-3 rounded-lg transition-all ${activeTab === Tab.SEND ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>I want to SEND</button>
          <button onClick={() => setActiveTab(Tab.RECEIVE)} className={`px-8 py-3 rounded-lg transition-all ${activeTab === Tab.RECEIVE ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>I want to RECEIVE</button>
        </div>

        <div className="mb-8 text-center">
          <p className="text-gray-400 text-sm mb-2">Your Device ID (Share this)</p>
          <div className="text-4xl font-mono font-bold text-yellow-400 tracking-widest bg-black/30 px-6 py-2 rounded-xl border border-yellow-400/30 select-all">
            {myPeerId || '...'}
          </div>
        </div>

        <div className="w-full max-w-2xl bg-gray-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          
          {activeTab === Tab.SEND && (
            <div className="space-y-6">
              <div className="border-2 border-dashed border-gray-600 rounded-2xl p-8 text-center relative hover:border-blue-500 transition-colors">
                <input type="file" onChange={(e) => setFileToSend(e.target.files?.[0] || null)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="space-y-2">
                    <p className="text-xl font-medium">{fileToSend ? fileToSend.name : "Select File to Send"}</p>
                    {fileToSend && <p className="text-xs text-gray-400">{(fileToSend.size / (1024*1024)).toFixed(2)} MB</p>}
                </div>
              </div>

              <div className="flex gap-2 items-center bg-gray-900 p-4 rounded-xl border border-gray-700">
                 <input 
                   type="text" 
                   placeholder="Enter Receiver's ID here" 
                   value={remotePeerId}
                   onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                   className="bg-transparent flex-1 outline-none text-white font-mono uppercase"
                 />
                 <button onClick={connectToPeer} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition-colors">Connect</button>
              </div>

              {transferProgress > 0 && (
                <div className="w-full space-y-2">
                    <div className="flex justify-between text-xs text-gray-400 px-1">
                        <span>{transferProgress === 100 ? 'Finished' : 'Sending...'}</span>
                        <span className="text-green-400 font-mono font-bold">{transferSpeed}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden relative">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full transition-all duration-200" style={{ width: `${transferProgress}%` }}></div>
                        <p className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">{transferProgress}%</p>
                    </div>
                </div>
              )}

              <button 
                onClick={sendFile} 
                disabled={!fileToSend || connectionStatus.includes('Initializing')}
                className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-xl font-bold shadow-lg disabled:opacity-50 transition-all transform active:scale-[0.98]"
              >
                Send Instantly 🚀
              </button>
            </div>
          )}

          {activeTab === Tab.RECEIVE && (
             <div className="space-y-6 text-center">
               <h2 className="text-2xl font-bold">Ready to Receive</h2>
               
               {!receivedFileMeta ? (
                 <div className="py-12 border-2 border-dashed border-gray-700 rounded-2xl">
                    <p className="text-gray-500">Waiting for sender to select a file...</p>
                 </div>
               ) : (
                 <div className="bg-gray-700/50 p-6 rounded-xl mt-4 border border-blue-500/30">
                   <p className="font-bold text-xl text-blue-300 mb-1">{receivedFileMeta.name}</p>
                   <p className="text-sm text-gray-400 mb-4">{(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB</p>
                   
                   <div className="space-y-4">
                       <div className="flex justify-between text-xs text-gray-400 px-1">
                           <span>Progress</span>
                           <span className="text-green-400 font-mono font-bold">{transferSpeed}</span>
                       </div>
                       <div className="w-full bg-gray-600 rounded-full h-3 overflow-hidden">
                           <div className="bg-green-500 h-full transition-all duration-200 shadow-[0_0_10px_rgba(34,197,94,0.5)]" style={{ width: `${transferProgress}%` }}></div>
                       </div>
                   </div>

                   {!isMotorReady && !isTransferComplete && (
                    <button 
                        onClick={prepareMotor}
                        className="w-full bg-green-600 hover:bg-green-500 py-4 rounded-xl font-bold shadow-lg mt-6 animate-pulse text-white transition-all"
                    >
                        Confirm & Start Receiving 💾
                    </button>
                   )}

                   {isTransferComplete && (
                    <div className="mt-6 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 font-bold">
                        ✅ File Saved to Disk
                    </div>
                   )}
                 </div>
               )}
               <p className="text-xs text-gray-500">Keep this tab active for maximum speed</p>
             </div>
          )}

        </div>
      </main>

       {/* Chat Widget */}
       <div className="fixed bottom-6 right-6 z-50">
        {!isChatOpen && (
          <button onClick={() => setIsChatOpen(true)} className="w-14 h-14 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full shadow-2xl flex items-center justify-center text-white text-2xl hover:scale-110 transition-transform">
              💬
          </button>
        )}
        {isChatOpen && (
          <div className="w-[350px] h-[500px] flex flex-col relative animate-in slide-in-from-bottom-5">
            <button onClick={() => setIsChatOpen(false)} className="absolute -top-3 -right-3 w-8 h-8 bg-gray-700 text-white rounded-full flex items-center justify-center shadow-lg z-10 hover:bg-red-500 transition-colors">✕</button>
            <div className="h-full rounded-2xl overflow-hidden shadow-2xl border border-white/10">
                <ChatBot />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
