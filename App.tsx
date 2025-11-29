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

  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  // Memory management for large files
  const chunksRef = useRef<ArrayBuffer[]>([]);

  // Chat Widget State
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    const peer = new Peer(shortId, { debug: 2 });

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

    return () => {
      peer.destroy();
    };
  }, []);

  // --- RECEIVER LOGIC ---
  const setupReceiverEvents = (conn: DataConnection) => {
    conn.on('open', () => {
      setConnectionStatus(`Connected securely to ${conn.peer}`);
    });

    conn.on('data', (data: any) => {
      // Step 1: New File Info
      if (data.type === 'meta') {
        setReceivedFileMeta(data.meta);
        chunksRef.current = []; // Clear previous memory
        setDownloadUrl(null);
        setTransferProgress(0);
      } 
      // Step 2: Receive Chunk
      else if (data.type === 'chunk') {
        chunksRef.current.push(data.chunk);
        
        // Optional: Update progress based on chunks received vs expected size
        // (Simplified here to avoid lag)
      } 
      // Step 3: File Complete
      else if (data.type === 'end') {
        const blob = new Blob(chunksRef.current, { type: data.mime });
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        setTransferProgress(100);
        chunksRef.current = []; // Free up memory after blob creation
      }
    });

    conn.on('close', () => {
      setConnectionStatus('Connection Closed');
      setTransferProgress(0);
      chunksRef.current = [];
    });

    conn.on('error', (err) => {
      console.error(err);
      setConnectionStatus('Connection Error');
    });
  };

  // --- SENDER LOGIC ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileToSend(e.target.files[0]);
      setTransferProgress(0);
    }
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current) return;

    setConnectionStatus(`Connecting to ${remotePeerId}...`);
    const conn = peerRef.current.connect(remotePeerId.toUpperCase());
    connRef.current = conn;
    setupReceiverEvents(conn);
  };

  const sendFile = () => {
    if (!connRef.current || !fileToSend) {
      alert("No connection or file!");
      return;
    }

    const conn = connRef.current;
    
    // 1. Send Metadata
    conn.send({
      type: 'meta',
      meta: {
        name: fileToSend.name,
        size: fileToSend.size,
        type: fileToSend.type
      }
    });

    setTransferProgress(1);

    // 2. Start Chunked Transfer
    const CHUNK_SIZE = 16 * 1024; // 16KB chunks (Safe for WebRTC)
    const fileReader = new FileReader();
    let offset = 0;

    fileReader.onload = (e) => {
      if (!e.target?.result) return;
      
      // Send chunk
      conn.send({
        type: 'chunk',
        chunk: e.target.result
      });

      offset += e.target.result.byteLength;

      // Update UI
      const progress = Math.min(100, Math.round((offset / fileToSend.size) * 100));
      setTransferProgress(progress);

      // Read next chunk
      if (offset < fileToSend.size) {
        readNextChunk();
      } else {
        // Finish
        conn.send({ type: 'end', mime: fileToSend.type });
        alert("File Sent Successfully!");
      }
    };

    const readNextChunk = () => {
      const slice = fileToSend.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    // Start reading
    readNextChunk();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]"></div>
      </div>

      <nav className="relative z-10 border-b border-white/10 backdrop-blur-md bg-gray-900/50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
           <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">SecureShare P2P</span>
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

        {/* YOUR ID DISPLAY */}
        <div className="mb-8 text-center">
          <p className="text-gray-400 text-sm mb-2">Your Device ID (Share this)</p>
          <div className="text-4xl font-mono font-bold text-yellow-400 tracking-widest bg-black/30 px-6 py-2 rounded-xl border border-yellow-400/30 select-all">
            {myPeerId || '...'}
          </div>
        </div>

        <div className="w-full max-w-2xl bg-gray-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          
          {/* SEND MODE */}
          {activeTab === Tab.SEND && (
            <div className="space-y-6">
              <div className="border-2 border-dashed border-gray-600 rounded-2xl p-8 text-center relative hover:border-blue-500">
                <input type="file" onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="space-y-2">
                    <p className="text-xl font-medium">{fileToSend ? fileToSend.name : "Select Large File to Send"}</p>
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
                <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div className="bg-blue-500 h-full transition-all duration-75" style={{ width: `${transferProgress}%` }}></div>
                </div>
              )}

              <button 
                onClick={sendFile} 
                disabled={!fileToSend || connectionStatus.includes('Initializing')}
                className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-xl font-bold shadow-lg disabled:opacity-50"
              >
                Send File (Chunked)
              </button>
            </div>
          )}

          {/* RECEIVE MODE */}
          {activeTab === Tab.RECEIVE && (
             <div className="space-y-6 text-center">
               <h2 className="text-2xl font-bold">Waiting for File...</h2>
               <p className="text-gray-400">Tell the sender to enter your ID: <span className="text-yellow-400 font-mono">{myPeerId}</span></p>

               {receivedFileMeta && (
                 <div className="bg-gray-700/50 p-4 rounded-xl mt-4">
                   <p className="font-bold text-lg">{receivedFileMeta.name}</p>
                   <p className="text-sm text-gray-400">{(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB</p>
                 </div>
               )}

               {downloadUrl ? (
                 <a 
                   href={downloadUrl} 
                   download={receivedFileMeta?.name}
                   className="block w-full bg-green-600 hover:bg-green-500 py-4 rounded-xl font-bold shadow-lg mt-4 animate-bounce"
                 >
                   Download Now
                 </a>
               ) : (
                  // Show loading if meta received but URL not ready
                  receivedFileMeta && (
                      <div className="mt-4">
                          <p className="text-blue-400 animate-pulse mb-2">Receiving Data...</p>
                          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden mx-auto max-w-xs">
                             <div className="bg-blue-500 h-full w-full animate-pulse"></div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">Do not close this tab</p>
                      </div>
                  )
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
