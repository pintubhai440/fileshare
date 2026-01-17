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
  const fileToSendRef = useRef<File | null>(null); 
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState<string>('0.0 MB/s');
  const [isWaitingForReceiver, setIsWaitingForReceiver] = useState(false);

  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);
  
  const bytesReceivedRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);
  const receivedFileMetaRef = useRef<FileMeta | null>(null);
  const writableStreamRef = useRef<any | null>(null); 

  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const peer = new Peer(shortId, { 
        debug: 1,
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

  const setupConnectionEvents = (conn: DataConnection) => {
    conn.on('open', () => setConnectionStatus(`Connected to ${conn.peer}`));

    conn.on('data', async (data: any) => {
      if (data.type === 'meta') {
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        setIsMotorReady(false);
        setIsTransferComplete(false);
        setTransferProgress(0);
      } 
      else if (data.type === 'ready_to_receive') {
        setIsWaitingForReceiver(false);
        startPumping();
      }
      else if ((data instanceof ArrayBuffer || data instanceof Uint8Array) && writableStreamRef.current) {
        const buffer = data instanceof Uint8Array ? data.buffer : data;
        await writableStreamRef.current.write(buffer);
        bytesReceivedRef.current += buffer.byteLength;
        if (receivedFileMetaRef.current) {
            updateProgressUI(bytesReceivedRef.current, receivedFileMetaRef.current.size);
        }
      } 
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
        const speedMBps = (bytesDiff / ((now - lastUpdateRef.current) / 1000)) / (1024 * 1024);
        
        setTransferProgress(percent);
        setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
        lastUpdateRef.current = now;
        lastBytesRef.current = currentBytes;
    }
  };

  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) return;
    try {
        // @ts-ignore
        const handle = await window.showSaveFilePicker({ 
            suggestedName: receivedFileMetaRef.current.name 
        });
        writableStreamRef.current = await handle.createWritable();
        setIsMotorReady(true);
        connRef.current.send({ type: 'ready_to_receive' });
    } catch (err) { console.log("User cancelled"); }
  };

  const startPumping = () => {
    const file = fileToSendRef.current;
    if (!file || !connRef.current) return;

    const CHUNK_SIZE = 16 * 1024 * 1024; 
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
    if (!connRef.current || !fileToSend) return;
    fileToSendRef.current = fileToSend;
    setIsWaitingForReceiver(true);
    connRef.current.send({
        type: 'meta',
        meta: { name: fileToSend.name, size: fileToSend.size, type: fileToSend.type }
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white relative font-sans overflow-x-hidden">
      {/* Background Decor - Same as your UI */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]"></div>
      </div>

      <nav className="relative z-10 border-b border-white/5 backdrop-blur-md bg-[#0a0f1e]/50">
        <div className="container mx-auto px-8 py-5 flex justify-between items-center">
           <span className="text-2xl font-black tracking-tighter">SecureShare</span>
           <div className="text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 px-4 py-1.5 rounded-full border border-emerald-500/20 font-bold">
             {connectionStatus}
           </div>
        </div>
      </nav>

      <main className="relative z-10 container mx-auto px-4 py-16 flex flex-col items-center">
        
        {/* Tab Switcher - Your Design */}
        <div className="bg-white/5 p-1.5 rounded-2xl inline-flex mb-12 border border-white/10 backdrop-blur-xl">
          <button onClick={() => setActiveTab(Tab.SEND)} className={`px-10 py-3.5 rounded-xl font-bold transition-all duration-300 ${activeTab === Tab.SEND ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>Send File</button>
          <button onClick={() => setActiveTab(Tab.RECEIVE)} className={`px-10 py-3.5 rounded-xl font-bold transition-all duration-300 ${activeTab === Tab.RECEIVE ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>Receive File</button>
        </div>

        <div className="mb-12 text-center">
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em] mb-4">Your Sharing ID</p>
          <div className="text-5xl font-mono font-black text-yellow-400 tracking-[0.25em] bg-yellow-400/5 px-10 py-6 rounded-[2rem] border border-yellow-400/20 shadow-2xl">
            {myPeerId || '----'}
          </div>
        </div>

        <div className="w-full max-w-2xl bg-[#13192a]/80 backdrop-blur-3xl border border-white/5 rounded-[3rem] p-12 shadow-2xl">
          
          {activeTab === Tab.SEND && (
            <div className="space-y-10">
              <div className="group border-2 border-dashed border-white/10 rounded-[2.5rem] p-12 text-center relative hover:border-blue-500/50 transition-all duration-500 bg-white/2">
                <input type="file" onChange={(e) => setFileToSend(e.target.files?.[0] || null)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <div className="space-y-4">
                    <div className="text-5xl mb-4 opacity-80 group-hover:scale-110 transition-transform duration-500">📄</div>
                    <p className="text-2xl font-bold tracking-tight">{fileToSend ? fileToSend.name : "Select any file"}</p>
                    {fileToSend && <p className="text-sm font-medium text-gray-500">{(fileToSend.size / (1024*1024)).toFixed(2)} MB • {fileToSend.type || 'Unknown Format'}</p>}
                </div>
              </div>

              <div className="flex gap-4 p-2.5 bg-black/40 rounded-2xl border border-white/5">
                 <input 
                   type="text" 
                   placeholder="RECEIVER ID" 
                   value={remotePeerId}
                   onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                   className="bg-transparent flex-1 px-6 py-4 outline-none text-white font-mono tracking-widest text-lg"
                 />
                 <button onClick={() => {
                    if(!peerRef.current || !remotePeerId) return;
                    const conn = peerRef.current.connect(remotePeerId.toUpperCase(), { reliable: true });
                    connRef.current = conn;
                    setupConnectionEvents(conn);
                 }} className="bg-white/5 hover:bg-white/10 px-8 py-4 rounded-xl text-sm font-black transition-all">CONNECT</button>
              </div>

              {transferProgress > 0 && (
                <div className="space-y-4">
                    <div className="flex justify-between text-[11px] font-black uppercase tracking-widest px-1">
                        <span className="text-blue-400">{transferProgress === 100 ? 'Finished' : 'Uploading...'}</span>
                        <span className="text-white/60">{transferSpeed}</span>
                    </div>
                    <div className="w-full bg-black/40 rounded-full h-6 p-1.5 border border-white/5 shadow-inner">
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-400 h-full rounded-full transition-all duration-500 relative shadow-lg" style={{ width: `${transferProgress}%` }}>
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-white">{transferProgress}%</span>
                        </div>
                    </div>
                </div>
              )}

              <button 
                onClick={handleSendAction} 
                disabled={!fileToSend || !connectionStatus.toLowerCase().includes('connected')}
                className="w-full bg-blue-600 hover:bg-blue-500 py-6 rounded-2xl font-black text-xl shadow-2xl shadow-blue-600/20 disabled:opacity-10 transition-all active:scale-[0.97]"
              >
                {isWaitingForReceiver ? "WAITING FOR RECEIVER... ⏳" : "SEND INSTANTLY 🚀"}
              </button>
            </div>
          )}

          {activeTab === Tab.RECEIVE && (
             <div className="space-y-10 text-center py-6">
               {!receivedFileMeta ? (
                 <div className="py-24 flex flex-col items-center space-y-6 opacity-20">
                    <div className="text-7xl">🛰️</div>
                    <p className="text-xl font-bold tracking-tight">Ready to receive any format</p>
                 </div>
               ) : (
                 <div className="bg-black/20 p-10 rounded-[2.5rem] border border-white/5 animate-in fade-in zoom-in duration-500">
                   <p className="text-[10px] text-blue-400 font-black tracking-[0.4em] uppercase mb-6">Incoming Transfer</p>
                   <h3 className="text-3xl font-black mb-2 truncate px-4">{receivedFileMeta.name}</h3>
                   <p className="text-sm font-bold text-gray-500 mb-10 tracking-tight">{(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB • {receivedFileMeta.type || 'File'}</p>
                   
                   <div className="space-y-4 mb-10">
                       <div className="flex justify-between text-[11px] font-black uppercase tracking-widest px-1">
                           <span className="text-gray-400">Download Progress</span>
                           <span className="text-emerald-400">{transferSpeed}</span>
                       </div>
                       <div className="w-full bg-black/60 rounded-full h-5 overflow-hidden border border-white/5">
                           <div className="bg-emerald-500 h-full transition-all duration-500 shadow-[0_0_25px_rgba(16,185,129,0.3)]" style={{ width: `${transferProgress}%` }}></div>
                       </div>
                   </div>

                   {!isMotorReady && !isTransferComplete && (
                    <button 
                        onClick={prepareMotor}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 py-6 rounded-2xl font-black text-xl shadow-2xl shadow-emerald-600/20 animate-bounce transition-all active:scale-[0.97]"
                    >
                        CONFIRM & SAVE 💾
                    </button>
                   )}

                   {isTransferComplete && (
                    <div className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400 font-black tracking-tight text-lg">
                        ✅ SAVED SUCCESSFULLY
                    </div>
                   )}
                 </div>
               )}
               <p className="text-[10px] text-white/20 font-black tracking-[0.3em] uppercase italic">P2P Encrypted Channel</p>
             </div>
          )}
        </div>
      </main>

       {/* Chat Widget UI */}
       <div className="fixed bottom-10 right-10 z-50">
        {!isChatOpen ? (
          <button onClick={() => setIsChatOpen(true)} className="w-16 h-16 bg-white text-black rounded-full shadow-2xl flex items-center justify-center text-2xl hover:scale-110 transition-transform active:scale-90 border-4 border-black/10">
              💬
          </button>
        ) : (
          <div className="w-[400px] h-[600px] flex flex-col relative animate-in slide-in-from-bottom-12 duration-500">
            <button onClick={() => setIsChatOpen(false)} className="absolute -top-3 -right-3 w-12 h-12 bg-[#13192a] text-white rounded-full flex items-center justify-center shadow-2xl z-[60] border border-white/10 hover:bg-red-500 transition-colors font-bold">✕</button>
            <div className="h-full rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10 bg-[#0a0f1e]">
                <ChatBot />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
