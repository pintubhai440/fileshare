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
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Initializing...');
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  // Send State
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const fileToSendRef = useRef<File | null>(null); // Quick access ref
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState<string>('0.0 MB/s');

  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);
  
  // Refs for Performance
  const bytesReceivedRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);
  const receivedFileMetaRef = useRef<FileMeta | null>(null);
  const writableStreamRef = useRef<any | null>(null); 

  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const peer = new Peer(shortId, { 
        debug: 1, // Increased debug for better logging
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
      setupConnectionEvents(conn);
    });

    peerRef.current = peer;
    return () => { peer.destroy(); };
  }, []);

  // --- HANDSHAKE & DATA LOGIC ---
  const setupConnectionEvents = (conn: DataConnection) => {
    conn.on('open', () => {
        setConnectionStatus(`Connected to ${conn.peer}`);
    });

    conn.on('data', async (data: any) => {
      // 1. If Receiver gets Meta
      if (data.type === 'meta') {
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        setIsMotorReady(false);
        setIsTransferComplete(false);
        setTransferProgress(0);
        setTransferSpeed('Waiting for confirmation...');
      } 
      // 2. If Sender gets "Ready" signal from Receiver
      else if (data.type === 'ready_to_receive') {
        console.log("Receiver is ready, starting pump...");
        startPumping();
      }
      // 3. If Receiver gets Binary Data
      else if ((data instanceof ArrayBuffer || data instanceof Uint8Array) && writableStreamRef.current) {
        const buffer = data instanceof Uint8Array ? data.buffer : data;
        await writableStreamRef.current.write(buffer);
        bytesReceivedRef.current += buffer.byteLength;
        if (receivedFileMetaRef.current) {
            updateProgressUI(bytesReceivedRef.current, receivedFileMetaRef.current.size);
        }
      } 
      // 4. End of transfer
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
  };

  const updateProgressUI = (currentBytes: number, totalSize: number) => {
    const now = Date.now();
    if (now - lastUpdateRef.current > 400) {
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

  // --- MOTOR SETUP (Receiver Side) ---
  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) return;
    try {
        // @ts-ignore
        const handle = await window.showSaveFilePicker({ suggestedName: receivedFileMetaRef.current.name });
        writableStreamRef.current = await handle.createWritable();
        setIsMotorReady(true);
        setTransferSpeed('Starting...');
        // Sending signal back to Sender
        connRef.current.send({ type: 'ready_to_receive' });
    } catch (err) { console.error("Save Cancelled"); }
  };

  // --- PUMPING LOGIC (Sender Side) ---
  const startPumping = () => {
    const file = fileToSendRef.current;
    if (!file || !connRef.current) return;

    const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB
    let offset = 0;
    const reader = new FileReader();

    reader.onload = (e) => {
        if (!e.target?.result || !connRef.current) return;
        connRef.current.send(e.target.result);
        offset += (e.target.result as ArrayBuffer).byteLength;
        updateProgressUI(offset, file.size);

        if (offset < file.size) { readNext(); } 
        else { connRef.current.send({ type: 'end' }); }
    };

    const readNext = () => {
        if (!connRef.current) return;
        // Flow Control: Don't overflow the buffer
        if (connRef.current.dataChannel.bufferedAmount > 64 * 1024 * 1024) {
            setTimeout(readNext, 50);
            return;
        }
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
    };

    readNext();
  };

  const handleSendAction = () => {
    if (!connRef.current || !fileToSend) {
        alert("Please connect and select a file first!");
        return;
    }
    fileToSendRef.current = fileToSend; // Set ref for the pump
    connRef.current.send({
        type: 'meta',
        meta: { name: fileToSend.name, size: fileToSend.size, type: fileToSend.type }
    });
    setTransferSpeed('Waiting for receiver to confirm...');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white relative font-sans">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-purple-600/10 rounded-full blur-[120px]"></div>
      </div>

      <nav className="relative z-10 border-b border-white/5 backdrop-blur-md bg-gray-900/50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
           <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">SecureShare</span>
           <div className="text-[10px] uppercase tracking-widest bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
             <span className={connectionStatus.includes('Connected') ? 'text-green-400' : 'text-yellow-400'}>{connectionStatus}</span>
           </div>
        </div>
      </nav>

      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center">
        
        {/* Tab Switcher */}
        <div className="bg-gray-800/80 p-1 rounded-2xl inline-flex mb-10 border border-white/5 backdrop-blur-md">
          <button onClick={() => setActiveTab(Tab.SEND)} className={`px-8 py-3 rounded-xl transition-all duration-300 ${activeTab === Tab.SEND ? 'bg-blue-600 text-white shadow-xl shadow-blue-900/20' : 'text-gray-400 hover:text-white'}`}>Send File</button>
          <button onClick={() => setActiveTab(Tab.RECEIVE)} className={`px-8 py-3 rounded-xl transition-all duration-300 ${activeTab === Tab.RECEIVE ? 'bg-purple-600 text-white shadow-xl shadow-purple-900/20' : 'text-gray-400 hover:text-white'}`}>Receive File</button>
        </div>

        {/* Device ID Display */}
        <div className="mb-10 text-center">
          <p className="text-gray-500 text-xs mb-3 tracking-widest uppercase">Your Sharing ID</p>
          <div className="text-4xl font-mono font-black text-yellow-400 tracking-[0.2em] bg-black/40 px-8 py-4 rounded-2xl border border-yellow-400/20 shadow-inner select-all">
            {myPeerId || '....'}
          </div>
        </div>

        <div className="w-full max-w-2xl bg-gray-800/40 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl">
          
          {activeTab === Tab.SEND && (
            <div className="space-y-8">
              <div className="group border-2 border-dashed border-gray-700 rounded-3xl p-10 text-center relative hover:border-blue-500 transition-all duration-300 bg-gray-900/30">
                <input type="file" onChange={(e) => setFileToSend(e.target.files?.[0] || null)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <div className="space-y-3">
                    <div className="text-4xl mb-2 group-hover:scale-110 transition-transform duration-300">📄</div>
                    <p className="text-xl font-semibold">{fileToSend ? fileToSend.name : "Drop file here or click"}</p>
                    {fileToSend && <p className="text-sm text-gray-500">{(fileToSend.size / (1024*1024)).toFixed(2)} MB</p>}
                </div>
              </div>

              <div className="flex gap-3 p-2 bg-black/20 rounded-2xl border border-white/5">
                 <input 
                   type="text" 
                   placeholder="RECEIVER ID" 
                   value={remotePeerId}
                   onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                   className="bg-transparent flex-1 px-4 py-3 outline-none text-white font-mono tracking-widest"
                 />
                 <button onClick={() => {
                    if(!peerRef.current || !remotePeerId) return;
                    const conn = peerRef.current.connect(remotePeerId.toUpperCase(), { reliable: true });
                    connRef.current = conn;
                    setupConnectionEvents(conn);
                 }} className="bg-white/10 hover:bg-white/20 px-6 py-3 rounded-xl text-sm font-bold transition-colors">Connect</button>
              </div>

              {transferProgress > 0 && (
                <div className="space-y-3">
                    <div className="flex justify-between text-xs px-1">
                        <span className="text-gray-400">Uploading...</span>
                        <span className="text-blue-400 font-mono font-bold">{transferSpeed}</span>
                    </div>
                    <div className="w-full bg-gray-900 rounded-full h-5 p-1 border border-white/5">
                        <div className="bg-gradient-to-r from-blue-600 to-cyan-400 h-full rounded-full transition-all duration-300 relative" style={{ width: `${transferProgress}%` }}>
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-black">{transferProgress}%</span>
                        </div>
                    </div>
                </div>
              )}

              <button 
                onClick={handleSendAction} 
                disabled={!fileToSend || !connectionStatus.includes('Connected')}
                className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-2xl font-black text-lg shadow-lg shadow-blue-600/20 disabled:opacity-20 transition-all active:scale-95"
              >
                SEND INSTANTLY 🚀
              </button>
            </div>
          )}

          {activeTab === Tab.RECEIVE && (
             <div className="space-y-8 text-center py-4">
               {!receivedFileMeta ? (
                 <div className="py-20 flex flex-col items-center space-y-4 opacity-40">
                    <div className="text-6xl animate-pulse">📡</div>
                    <p className="text-lg">Waiting for incoming file...</p>
                 </div>
               ) : (
                 <div className="bg-gray-900/50 p-8 rounded-3xl border border-blue-500/20 animate-in fade-in zoom-in duration-300">
                   <p className="text-xs text-blue-400 font-bold tracking-[0.3em] uppercase mb-4">Incoming File</p>
                   <h3 className="text-2xl font-bold mb-1 truncate">{receivedFileMeta.name}</h3>
                   <p className="text-sm text-gray-500 mb-8">Size: {(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB</p>
                   
                   <div className="space-y-4 mb-8">
                       <div className="flex justify-between text-xs px-1">
                           <span className="text-gray-400">Download Status</span>
                           <span className="text-green-400 font-mono font-bold">{transferSpeed}</span>
                       </div>
                       <div className="w-full bg-black/40 rounded-full h-4 overflow-hidden border border-white/5">
                           <div className="bg-green-500 h-full transition-all duration-300 shadow-[0_0_15px_rgba(34,197,94,0.4)]" style={{ width: `${transferProgress}%` }}></div>
                       </div>
                   </div>

                   {!isMotorReady && !isTransferComplete && (
                    <button 
                        onClick={prepareMotor}
                        className="w-full bg-green-600 hover:bg-green-500 py-5 rounded-2xl font-black text-lg shadow-lg shadow-green-600/20 animate-bounce transition-all active:scale-95"
                    >
                        CONFIRM & SAVE 💾
                    </button>
                   )}

                   {isTransferComplete && (
                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-2xl text-green-400 font-black">
                        COMPLETED & SAVED TO DISK
                    </div>
                   )}
                 </div>
               )}
               <p className="text-[10px] text-gray-600 tracking-widest uppercase italic">Secure Direct Peer-to-Peer Transfer</p>
             </div>
          )}
        </div>
      </main>

       {/* Chat Widget UI */}
       <div className="fixed bottom-8 right-8 z-50">
        {!isChatOpen ? (
          <button onClick={() => setIsChatOpen(true)} className="w-16 h-16 bg-white text-black rounded-full shadow-2xl flex items-center justify-center text-2xl hover:scale-110 transition-transform active:scale-95">
              💬
          </button>
        ) : (
          <div className="w-[380px] h-[550px] flex flex-col relative animate-in slide-in-from-bottom-10 duration-300">
            <button onClick={() => setIsChatOpen(false)} className="absolute -top-2 -right-2 w-10 h-10 bg-gray-800 text-white rounded-full flex items-center justify-center shadow-2xl z-[60] border border-white/10 hover:bg-red-500 transition-colors">✕</button>
            <div className="h-full rounded-[2rem] overflow-hidden shadow-2xl border border-white/10 bg-gray-900">
                <ChatBot />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
