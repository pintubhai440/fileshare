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
  const [transferSpeed, setTransferSpeed] = useState<string>('0 MB/s');

  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  // High Performance Refs
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const bytesReceivedRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);
  const receivedFileMetaRef = useRef<FileMeta | null>(null);

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

  // --- RECEIVER (Fixed: Instant Smooth Progress) ---
  const setupReceiverEvents = (conn: DataConnection) => {
    conn.on('open', () => setConnectionStatus(`Connected securely to ${conn.peer}`));

    conn.on('data', (data: any) => {
      if (data instanceof ArrayBuffer) {
        chunksRef.current.push(data);
        bytesReceivedRef.current += data.byteLength;
        
        const now = Date.now();
        // ✅ FIX: Reduced delay to 100ms for buttery smooth progress bar
        if (now - lastUpdateRef.current > 100 && receivedFileMetaRef.current) {
            const totalSize = receivedFileMetaRef.current.size;
            const percent = Math.min(100, Math.round((bytesReceivedRef.current / totalSize) * 100));
            
            const bytesDiff = bytesReceivedRef.current - lastBytesRef.current;
            const timeDiff = (now - lastUpdateRef.current) / 1000;
            const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
            
            setTransferProgress(percent);
            setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
            
            lastUpdateRef.current = now;
            lastBytesRef.current = bytesReceivedRef.current;
        }
      } 
      else if (data.type === 'meta') {
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        
        chunksRef.current = []; 
        bytesReceivedRef.current = 0;
        lastBytesRef.current = 0;
        lastUpdateRef.current = Date.now();
        
        setDownloadUrl(null);
        setTransferProgress(0);
        setTransferSpeed('🚀 Starting...');
      } 
      else if (data.type === 'end') {
        setTransferProgress(100);
        setTransferSpeed('Processing...');
        
        setTimeout(() => {
            if (receivedFileMetaRef.current) {
                const blob = new Blob(chunksRef.current, { type: receivedFileMetaRef.current.type });
                const url = URL.createObjectURL(blob);
                setDownloadUrl(url);
                chunksRef.current = []; 
                setTransferSpeed('Done! Click Save.');
            }
        }, 10);
      }
    });

    conn.on('close', () => {
      setConnectionStatus('Connection Closed');
      setTransferProgress(0);
    });
  };

  // --- SENDER (Flash Mode) ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileToSend(e.target.files[0]);
      setTransferProgress(0);
      setTransferSpeed('0 MB/s');
    }
  };

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

    const conn = connRef.current;
    
    conn.send({
      type: 'meta',
      meta: { name: fileToSend.name, size: fileToSend.size, type: fileToSend.type }
    });

    setTransferProgress(1);
    
    // 64KB Chunk for best consistency
    const CHUNK_SIZE = 64 * 1024; 
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
        
        const now = Date.now();
        // Sender UI also updated to 100ms for smoothness
        if (now - lastUpdateRef.current > 100) {
             const progress = Math.min(100, Math.round((offset / fileToSend.size) * 100));
             const bytesDiff = offset - lastBytesRef.current;
             const timeDiff = (now - lastUpdateRef.current) / 1000;
             const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);

             setTransferProgress(progress);
             setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
             lastUpdateRef.current = now;
             lastBytesRef.current = offset;
        }

        if (offset < fileToSend.size) {
           readNextChunk();
        } else {
           conn.send({ type: 'end' });
           setTransferProgress(100);
           setTransferSpeed('Sent!');
        }
      } catch (error) {
         readNextChunk();
      }
    };

    const readNextChunk = () => {
      if (conn.dataChannel.bufferedAmount > 16 * 1024 * 1024) {
          setTimeout(readNextChunk, 1); 
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
           <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">SecureShare (Smooth UI)</span>
           <div className="text-xs bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
             Status: <span className="text-green-400">{connectionStatus}</span>
           </div>
        </div>
      </nav>

      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center">
        
        <div className="bg-gray-800 p-1 rounded-xl inline-flex mb-8 shadow-lg border border-gray-700">
          <button onClick={() => setActiveTab(Tab.SEND)} className={`px-8 py-3 rounded-lg ${activeTab === Tab.SEND ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>I want to SEND</button>
          <button onClick={() => setActiveTab(Tab.RECEIVE)} className={`px-8 py-3 rounded-lg ${activeTab === Tab.RECEIVE ? 'bg-purple-600 text-white' : 'text-gray-400'}`}>I want to RECEIVE</button>
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
              <div className="border-2 border-dashed border-gray-600 rounded-2xl p-8 text-center relative hover:border-blue-500">
                <input type="file" onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
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
                 <button onClick={connectToPeer} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">Connect</button>
              </div>

              {transferProgress > 0 && (
                <div className="w-full space-y-2">
                    <div className="flex justify-between text-xs text-gray-400">
                        <span>Sending...</span>
                        <span className="text-green-400 font-mono">{transferSpeed}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden relative">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full transition-all duration-200" style={{ width: `${transferProgress}%` }}></div>
                        <p className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-md">{transferProgress}%</p>
                    </div>
                </div>
              )}

              <button 
                onClick={sendFile} 
                disabled={!fileToSend || connectionStatus.includes('Initializing')}
                className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-xl font-bold shadow-lg disabled:opacity-50"
              >
                Send Instantly 🚀
              </button>
            </div>
          )}

          {activeTab === Tab.RECEIVE && (
             <div className="space-y-6 text-center">
               <h2 className="text-2xl font-bold">Ready to Receive</h2>
               <p className="text-gray-400">Your ID: <span className="text-yellow-400 font-mono font-bold text-lg">{myPeerId}</span></p>

               {receivedFileMeta && (
                 <div className="bg-gray-700/50 p-4 rounded-xl mt-4">
                   <p className="font-bold text-lg text-blue-300">Receiving: {receivedFileMeta.name}</p>
                   <p className="text-sm text-gray-400">{(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB</p>
                   
                   <div className="mt-4 space-y-2">
                       <div className="flex justify-between text-xs text-gray-400 px-1">
                           <span>Progress</span>
                           <span className="text-green-400 font-mono">{transferSpeed}</span>
                       </div>
                       <div className="w-full bg-gray-600 rounded-full h-3 overflow-hidden">
                           <div className="bg-green-500 h-full transition-all duration-200 shadow-[0_0_10px_rgba(34,197,94,0.5)]" style={{ width: `${transferProgress}%` }}></div>
                       </div>
                       <p className="text-xs text-right text-gray-300 font-bold">{transferProgress}%</p>
                   </div>
                 </div>
               )}

               {downloadUrl ? (
                 <a 
                   href={downloadUrl} 
                   download={receivedFileMeta?.name}
                   className="block w-full bg-green-600 hover:bg-green-500 py-4 rounded-xl font-bold shadow-lg mt-4 animate-bounce"
                 >
                   Save File Now
                 </a>
               ) : (
                  !receivedFileMeta && <div className="text-gray-500 text-sm mt-4">Keep this tab open while receiving</div>
               )}
             </div>
          )}

        </div>
      </main>

       {/* Chat Widget */}
       <div className="fixed bottom-6 right-6 z-50">
        {!isChatOpen && (
          <button onClick={() => setIsChatOpen(true)} className="w-14 h-14 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full shadow-2xl flex items-center justify-center text-white">
             💬
          </button>
        )}
        {isChatOpen && (
          <div className="w-[350px] h-[500px] flex flex-col relative">
            <button onClick={() => setIsChatOpen(false)} className="absolute -top-3 -right-3 w-8 h-8 bg-gray-700 text-white rounded-full flex items-center justify-center shadow-lg z-10">X</button>
            <ChatBot />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
