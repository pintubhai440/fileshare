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
  const [sendPreview, setSendPreview] = useState<string | null>(null);
  const fileToSendRef = useRef<File | null>(null); 
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState<string>('0.0 MB/s');
  const [isWaitingForReceiver, setIsWaitingForReceiver] = useState(false);

  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [receivePreview, setReceivePreview] = useState<string | null>(null);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);
  const [chunkCount, setChunkCount] = useState(0); 
  
  const bytesReceivedRef = useRef(0);
  const chunksForPreviewRef = useRef<Uint8Array[]>([]); 
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
        setChunkCount(0);
        chunksForPreviewRef.current = []; 
        setReceivePreview(null);
      } 
      else if (data.type === 'ready_to_receive') {
        setIsWaitingForReceiver(false);
        startPumping();
      }
      else if ((data instanceof ArrayBuffer || data instanceof Uint8Array)) {
        const buffer = data instanceof Uint8Array ? data.buffer : data;
        
        if (writableStreamRef.current) {
            await writableStreamRef.current.write(buffer);
        }

        setChunkCount(prev => prev + 1);

        // Preview only for images to keep memory clean
        if (receivedFileMetaRef.current?.type.startsWith('image/') && chunksForPreviewRef.current.length < 5) {
            chunksForPreviewRef.current.push(new Uint8Array(buffer));
        }

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
        
        if (receivedFileMetaRef.current?.type.startsWith('image/')) {
            const blob = new Blob(chunksForPreviewRef.current, { type: receivedFileMetaRef.current.type });
            setReceivePreview(URL.createObjectURL(blob));
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFileToSend(file);
    if (file && file.type.startsWith('image/')) {
        setSendPreview(URL.createObjectURL(file));
    } else {
        setSendPreview(null);
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
    } catch (err) { console.log("Save cancelled by user"); }
  };

  const startPumping = () => {
    const file = fileToSendRef.current;
    if (!file || !connRef.current) return;

    const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB Chunks
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
    <div className="min-h-screen bg-[#0a0f1e] text-white relative font-sans overflow-y-auto pb-32">
      {/* Background Glows */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[120px]"></div>
      </div>

      <nav className="relative z-10 border-b border-white/5 backdrop-blur-xl bg-[#0a0f1e]/60 sticky top-0 shadow-2xl">
        <div className="container mx-auto px-6 py-5 flex justify-between items-center">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-black text-xl shadow-lg shadow-blue-600/20">S</div>
              <span className="text-2xl font-black tracking-tighter">SecureShare</span>
           </div>
           <div className="text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-full border border-emerald-500/20 font-black shadow-inner">
             ● {connectionStatus}
           </div>
        </div>
      </nav>

      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center">
        
        {/* Tab Selection */}
        <div className="bg-white/5 p-1.5 rounded-[1.5rem] inline-flex mb-12 border border-white/10 backdrop-blur-3xl shadow-2xl">
          <button onClick={() => setActiveTab(Tab.SEND)} className={`px-10 py-4 rounded-2xl font-black transition-all duration-500 ${activeTab === Tab.SEND ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/40 translate-y-[-2px]' : 'text-gray-500 hover:text-white'}`}>SEND MODE</button>
          <button onClick={() => setActiveTab(Tab.RECEIVE)} className={`px-10 py-4 rounded-2xl font-black transition-all duration-500 ${activeTab === Tab.RECEIVE ? 'bg-white/10 text-white shadow-xl translate-y-[-2px]' : 'text-gray-500 hover:text-white'}`}>RECEIVE MODE</button>
        </div>

        {/* Peer ID Card */}
        <div className="mb-12 text-center group">
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.4em] mb-4 opacity-50">Local Station ID</p>
          <div className="text-4xl md:text-6xl font-mono font-black text-yellow-400 tracking-[0.2em] bg-yellow-400/5 px-12 py-8 rounded-[2.5rem] border border-yellow-400/20 shadow-[0_0_50px_rgba(250,204,21,0.1)] inline-block transition-transform group-hover:scale-105 duration-500">
            {myPeerId || '----'}
          </div>
        </div>

        {/* Action Container */}
        <div className="w-full max-w-2xl bg-[#13192a]/80 backdrop-blur-3xl border border-white/5 rounded-[3.5rem] p-8 md:p-14 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
          
          {activeTab === Tab.SEND && (
            <div className="space-y-10">
              <div className="group border-2 border-dashed border-white/10 rounded-[3rem] p-10 text-center relative hover:border-blue-500/50 transition-all duration-500 bg-black/20 overflow-hidden">
                <input type="file" onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" title="Select File" />
                <div className="space-y-6">
                    {sendPreview ? (
                        <img src={sendPreview} alt="Preview" className="w-40 h-40 mx-auto object-cover rounded-[2rem] border-4 border-white/10 shadow-2xl animate-in zoom-in duration-500" />
                    ) : (
                        <div className="text-7xl mb-4 opacity-30 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500">📄</div>
                    )}
                    <div>
                      <p className="text-2xl font-black tracking-tight truncate px-4">{fileToSend ? fileToSend.name : "Drop or Select File"}</p>
                      {fileToSend && <p className="text-xs font-black text-blue-400 mt-2 tracking-widest uppercase">{(fileToSend.size / (1024*1024)).toFixed(2)} MB • {fileToSend.type.split('/')[1]?.toUpperCase() || 'FILE'}</p>}
                    </div>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-4 p-3 bg-black/40 rounded-[2rem] border border-white/5 shadow-inner">
                 <input 
                   type="text" 
                   placeholder="ENTER RECEIVER ID" 
                   value={remotePeerId}
                   onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                   className="bg-transparent flex-1 px-6 py-4 outline-none text-white font-mono tracking-[0.3em] text-xl placeholder:opacity-20"
                 />
                 <button onClick={() => {
                    if(!peerRef.current || !remotePeerId) return;
                    const conn = peerRef.current.connect(remotePeerId.toUpperCase(), { reliable: true });
                    connRef.current = conn;
                    setupConnectionEvents(conn);
                 }} className="bg-white/10 hover:bg-white/20 px-10 py-4 rounded-[1.5rem] text-xs font-black tracking-widest transition-all active:scale-95">CONNECT</button>
              </div>

              {transferProgress > 0 && (
                <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex justify-between text-[11px] font-black uppercase tracking-widest px-2">
                        <span className="text-blue-400 flex items-center gap-2">
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                          {transferProgress === 100 ? 'Transmission Finished' : 'Pumping Data...'}
                        </span>
                        <span className="text-white/40">{transferSpeed}</span>
                    </div>
                    <div className="w-full bg-black/60 rounded-full h-8 p-1.5 border border-white/5 shadow-inner overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-700 via-blue-500 to-indigo-400 h-full rounded-full transition-all duration-500 relative shadow-lg shadow-blue-500/20" style={{ width: `${transferProgress}%` }}>
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-white">{transferProgress}%</span>
                        </div>
                    </div>
                </div>
              )}

              <button 
                onClick={handleSendAction} 
                disabled={!fileToSend || !connectionStatus.toLowerCase().includes('connected')}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-white/20 py-8 rounded-[2rem] font-black text-2xl shadow-2xl shadow-blue-600/30 transition-all active:scale-[0.98] uppercase tracking-tighter"
              >
                {isWaitingForReceiver ? "Awaiting Confirmation..." : "Transmit Now ⚡"}
              </button>
            </div>
          )}

          {activeTab === Tab.RECEIVE && (
             <div className="space-y-12 text-center py-4">
               {!receivedFileMeta ? (
                 <div className="py-24 flex flex-col items-center space-y-8 opacity-10">
                    <div className="text-9xl animate-pulse">📡</div>
                    <p className="text-2xl font-black tracking-widest uppercase">Waiting for Uplink</p>
                 </div>
               ) : (
                 <div className="bg-black/30 p-10 rounded-[3.5rem] border border-white/5 animate-in fade-in zoom-in duration-700 shadow-2xl">
                   <p className="text-[11px] text-blue-400 font-black tracking-[0.5em] uppercase mb-8">Data Incoming</p>
                   
                   {receivePreview ? (
                        <img src={receivePreview} alt="Received" className="w-48 h-48 mx-auto object-cover rounded-[2.5rem] border-4 border-emerald-500/20 mb-8 shadow-2xl shadow-emerald-500/10" />
                   ) : (
                        <div className="text-8xl mb-8 filter drop-shadow-2xl">📦</div>
                   )}

                   <h3 className="text-3xl font-black mb-4 truncate px-4 tracking-tight">{receivedFileMeta.name}</h3>
                   
                   <div className="flex justify-center gap-4 mb-12">
                      <span className="text-[10px] font-black text-gray-400 bg-white/5 px-5 py-2 rounded-full border border-white/5 uppercase tracking-widest">{(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB</span>
                      <span className="text-[10px] font-black text-emerald-400 bg-emerald-400/5 px-5 py-2 rounded-full border border-emerald-400/10 uppercase tracking-widest">{chunkCount} Data Blocks</span>
                   </div>
                   
                   <div className="space-y-5 mb-12">
                       <div className="flex justify-between text-[11px] font-black uppercase tracking-widest px-2">
                           <span className="text-gray-500">Download Sync</span>
                           <span className="text-emerald-400 font-mono">{transferSpeed}</span>
                       </div>
                       <div className="w-full bg-black/60 rounded-full h-7 overflow-hidden border border-white/5 shadow-inner p-1">
                           <div className="bg-gradient-to-r from-emerald-600 to-teal-400 h-full rounded-full transition-all duration-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]" style={{ width: `${transferProgress}%` }}></div>
                       </div>
                   </div>

                   {!isMotorReady && !isTransferComplete && (
                    <button 
                        onClick={prepareMotor}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 py-8 rounded-[2rem] font-black text-2xl shadow-2xl shadow-emerald-600/30 animate-bounce transition-all active:scale-[0.98] uppercase"
                    >
                        Accept & Save 💾
                    </button>
                   )}

                   {isTransferComplete && (
                    <div className="p-8 bg-emerald-500/10 border-2 border-emerald-500/20 rounded-[2.5rem] text-emerald-400 font-black tracking-widest text-xl shadow-inner animate-in zoom-in">
                        MISSION ACCOMPLISHED ✅
                    </div>
                   )}
                 </div>
               )}
               <div className="flex items-center justify-center gap-2 opacity-30">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                  <p className="text-[9px] text-white font-black tracking-[0.5em] uppercase italic">P2P Military Grade Encryption Active</p>
               </div>
             </div>
          )}
        </div>
      </main>

      {/* Modern Chat Widget */}
      <div className="fixed bottom-8 right-8 z-50">
        {!isChatOpen ? (
          <button onClick={() => setIsChatOpen(true)} className="w-20 h-20 bg-white text-black rounded-[2rem] shadow-[0_20px_50px_rgba(255,255,255,0.1)] flex items-center justify-center text-3xl hover:scale-110 hover:rotate-6 transition-all active:scale-90 border-8 border-black/5 group">
              <span className="group-hover:animate-bounce">💬</span>
          </button>
        ) : (
          <div className="w-[350px] md:w-[450px] h-[600px] md:h-[750px] flex flex-col relative animate-in slide-in-from-bottom-24 duration-700 ease-out">
            <button onClick={() => setIsChatOpen(false)} className="absolute -top-4 -right-4 w-12 h-12 bg-red-500 text-white rounded-2xl flex items-center justify-center shadow-2xl z-[60] border-4 border-[#0a0f1e] hover:bg-red-600 transition-all font-black hover:rotate-90">✕</button>
            <div className="h-full rounded-[3.5rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/10 bg-[#0a0f1e]">
                <ChatBot />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
