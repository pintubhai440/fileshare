import React, { useState, useEffect } from 'react';
import { Tab, TransferFile } from './types';
import { ChatBot } from './components/ChatBot';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.SEND);
  
  // "Server" state (mocking cloud storage)
  const [uploadedFiles, setUploadedFiles] = useState<TransferFile[]>([]);
  
  // Send State
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const [senderPin, setSenderPin] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lastUploadedCode, setLastUploadedCode] = useState<string | null>(null);

  // Receive State
  const [receiveCode, setReceiveCode] = useState('');
  const [receivePin, setReceivePin] = useState('');
  const [foundFile, setFoundFile] = useState<TransferFile | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Chat Widget State
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Cleanup expired files
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setUploadedFiles(prev => prev.filter(f => f.expiresAt > now));
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  // --- Send Logic ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFileToSend(file);
      setLastUploadedCode(null);
      setUploadProgress(0);
    }
  };

  const handleUpload = () => {
    if (!fileToSend || senderPin.length < 4) {
      alert("Please select a file and set a 4+ digit PIN.");
      return;
    }

    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      setUploadProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        finalizeUpload();
      }
    }, 100);
  };

  const finalizeUpload = () => {
    if (!fileToSend) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newFile: TransferFile = {
      id: code,
      name: fileToSend.name,
      size: fileToSend.size,
      type: fileToSend.type,
      pin: senderPin,
      blobUrl: URL.createObjectURL(fileToSend),
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000, // 1 hour
    };

    setUploadedFiles(prev => [...prev, newFile]);
    setLastUploadedCode(code);
    setFileToSend(null);
    setSenderPin('');
  };

  // --- Receive Logic ---
  const handleReceiveCheck = () => {
    setErrorMsg('');
    const file = uploadedFiles.find(f => f.id === receiveCode.toUpperCase());
    
    if (!file) {
      setErrorMsg("File not found or expired.");
      return;
    }

    if (file.pin !== receivePin) {
      setErrorMsg("Incorrect PIN.");
      return;
    }

    setFoundFile(file);
  };

  const handleDownload = () => {
    if (!foundFile) return;
    
    // Simulate high speed download
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setDownloadProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        
        // Trigger actual download
        const a = document.createElement('a');
        a.href = foundFile.blobUrl;
        a.download = foundFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }, 100);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]"></div>
      </div>

      {/* Navbar */}
      <nav className="relative z-10 border-b border-white/10 backdrop-blur-md bg-gray-900/50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">SecureShare AI</span>
          </div>
          <div className="text-sm text-gray-400 hidden md:block">
            Supports files up to <span className="text-blue-400 font-semibold">500GB</span>
          </div>
        </div>
      </nav>

      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center">
        
        {/* Toggle Switch */}
        <div className="bg-gray-800 p-1 rounded-xl inline-flex mb-12 shadow-lg border border-gray-700">
          <button
            onClick={() => setActiveTab(Tab.SEND)}
            className={`px-8 py-3 rounded-lg text-sm font-medium transition-all duration-300 ${
              activeTab === Tab.SEND ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
            }`}
          >
            Send Files
          </button>
          <button
            onClick={() => { setActiveTab(Tab.RECEIVE); setFoundFile(null); setDownloadProgress(0); setReceiveCode(''); setReceivePin(''); }}
            className={`px-8 py-3 rounded-lg text-sm font-medium transition-all duration-300 ${
              activeTab === Tab.RECEIVE ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
            }`}
          >
            Receive Files
          </button>
        </div>

        {/* Content Area */}
        <div className="w-full max-w-2xl min-h-[500px]">
          
          {/* SEND TAB */}
          {activeTab === Tab.SEND && (
            <div className="bg-gray-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl animate-fade-in-up">
              {!lastUploadedCode ? (
                <>
                  <div className="border-2 border-dashed border-gray-600 rounded-2xl p-10 text-center hover:border-blue-500 transition-colors relative group">
                    <input type="file" onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <div className="space-y-4">
                      <div className="w-16 h-16 bg-gray-700 rounded-full mx-auto flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      </div>
                      <div>
                        <p className="text-xl font-medium text-white">
                          {fileToSend ? fileToSend.name : "Drop your file here or browse"}
                        </p>
                        <p className="text-sm text-gray-400 mt-2">
                          {fileToSend ? `${(fileToSend.size / (1024*1024)).toFixed(2)} MB` : "Supports large files up to 500GB"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">Set Security PIN</label>
                      <input
                        type="password"
                        maxLength={6}
                        value={senderPin}
                        onChange={(e) => setSenderPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="Enter 4-6 digits"
                        className="w-full bg-gray-900 border border-gray-700 rounded-xl px-5 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none tracking-widest text-lg"
                      />
                    </div>

                    {uploadProgress > 0 && uploadProgress < 100 && (
                      <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                    )}

                    <button
                      onClick={handleUpload}
                      disabled={!fileToSend || uploadProgress > 0}
                      className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-xl shadow-lg transform transition hover:-translate-y-1 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {uploadProgress > 0 ? `Uploading... ${uploadProgress}%` : 'Secure Transfer'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="w-20 h-20 bg-green-500/20 rounded-full mx-auto flex items-center justify-center mb-6">
                    <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-2">File Ready!</h2>
                  <p className="text-gray-400 mb-8">Share these credentials with the recipient.</p>
                  
                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Transfer Code</p>
                      <p className="text-2xl font-mono text-blue-400 font-bold tracking-wider">{lastUploadedCode}</p>
                    </div>
                    <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Security PIN</p>
                      <p className="text-2xl font-mono text-purple-400 font-bold tracking-wider">{senderPin}</p>
                    </div>
                  </div>

                  <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg text-yellow-200 text-sm mb-8 flex items-start gap-3">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p>This file will be automatically deleted in 1 hour for security purposes.</p>
                  </div>

                  <button 
                    onClick={() => { setLastUploadedCode(null); setFileToSend(null); setSenderPin(''); }}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    Send another file
                  </button>
                </div>
              )}
            </div>
          )}

          {/* RECEIVE TAB */}
          {activeTab === Tab.RECEIVE && (
             <div className="bg-gray-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl animate-fade-in-up">
               {!foundFile ? (
                 <div className="space-y-6 py-4">
                   <h2 className="text-2xl font-bold text-center mb-8">Download Secure File</h2>
                   
                   <div>
                     <label className="block text-sm font-medium text-gray-400 mb-2">Transfer Code</label>
                     <input
                       type="text"
                       maxLength={6}
                       value={receiveCode}
                       onChange={(e) => setReceiveCode(e.target.value.toUpperCase())}
                       placeholder="Ex: X7Y2Z1"
                       className="w-full bg-gray-900 border border-gray-700 rounded-xl px-5 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none font-mono text-lg uppercase placeholder:normal-case placeholder:font-sans"
                     />
                   </div>

                   <div>
                     <label className="block text-sm font-medium text-gray-400 mb-2">Security PIN</label>
                     <input
                       type="password"
                       maxLength={6}
                       value={receivePin}
                       onChange={(e) => setReceivePin(e.target.value.replace(/\D/g, ''))}
                       placeholder="Enter PIN"
                       className="w-full bg-gray-900 border border-gray-700 rounded-xl px-5 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none tracking-widest text-lg"
                     />
                   </div>

                   {errorMsg && (
                     <p className="text-red-400 text-sm text-center bg-red-400/10 py-2 rounded-lg">{errorMsg}</p>
                   )}

                   <button
                     onClick={handleReceiveCheck}
                     className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-4 rounded-xl shadow-lg transform transition hover:-translate-y-1 active:scale-95 mt-4"
                   >
                     Access File
                   </button>
                 </div>
               ) : (
                 <div className="text-center py-8">
                    <div className="mb-6">
                      <div className="w-16 h-16 bg-purple-500/20 rounded-2xl mx-auto flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <h3 className="text-xl font-bold text-white break-all">{foundFile.name}</h3>
                      <p className="text-gray-400 mt-1">{(foundFile.size / (1024*1024)).toFixed(2)} MB</p>
                    </div>

                    {downloadProgress > 0 && downloadProgress < 100 && (
                      <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden mb-6">
                        <div className="bg-green-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                        <p className="text-xs text-gray-400 mt-2 text-right">{downloadProgress}%</p>
                      </div>
                    )}

                    <button
                      onClick={handleDownload}
                      disabled={downloadProgress > 0}
                      className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {downloadProgress === 100 ? 'Downloaded!' : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" /></svg>
                          Download Now
                        </>
                      )}
                    </button>
                 </div>
               )}
             </div>
          )}
        </div>
      </main>

      {/* Chat Widget Button & Panel */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="w-14 h-14 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-110 transition-transform animate-bounce-slow"
          >
             <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
          </button>
        )}
        
        {isChatOpen && (
          <div className="w-[350px] h-[500px] flex flex-col relative animate-fade-in-up">
            <button
               onClick={() => setIsChatOpen(false)}
               className="absolute -top-3 -right-3 w-8 h-8 bg-gray-700 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-gray-600 z-10"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <ChatBot />
          </div>
        )}
      </div>

      <style>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.4s ease-out forwards;
        }
        .animate-bounce-slow {
          animation: bounce 3s infinite;
        }
      `}</style>
    </div>
  );
};

export default App;