// 🔥 UPDATED: Multi-File Batch Upload Support
  const uploadToGoogleDrive = async () => {
    if (filesQueue.length === 0) return;
    
    setIsUploadingCloud(true);
    setTransferProgress(0);
    
    const uploadedLinks: string[] = []; // सारे लिंक्स यहाँ जमा होंगे

    try {
      // Loop through ALL selected files
      for (let i = 0; i < filesQueue.length; i++) {
        const file = filesQueue[i];
        
        // Update Status
        setTransferSpeed(`Preparing file ${i + 1} of ${filesQueue.length}: ${file.name}...`);

        // 1. Get Link for Current File
        const authResponse = await fetch('/api/upload-to-drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            name: file.name, 
            type: file.type || 'application/octet-stream' 
          })
        });

        if (!authResponse.ok) throw new Error(`Failed to get link for ${file.name}`);
        const { uploadUrl } = await authResponse.json();

        // 2. Upload File (Wrapped in Promise for Loop)
        const fileLink = await new Promise<string>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', uploadUrl, true);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                // Show progress for current file
                setTransferSpeed(`Uploading ${i + 1}/${filesQueue.length}: ${file.name} (${percent}%)`);
                setTransferProgress(percent);
              }
            };

            xhr.onload = () => {
              if (xhr.status === 200 || xhr.status === 201) {
                try {
                  const result = JSON.parse(xhr.responseText);
                  resolve(result.webViewLink);
                } catch (e) {
                  // Fallback if JSON fails but upload worked
                  resolve("Link Unavailable");
                }
              } else {
                reject(new Error(`Upload failed: ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error('Network Error'));
            xhr.send(file);
        });

        // लिंक लिस्ट में डालें
        uploadedLinks.push(fileLink);
      }

      // 3. Final Success State
      setTransferSpeed('All Files Uploaded Successfully! 🎉');
      setTransferProgress(100);
      
      // सारे लिंक्स को एक साथ दिखाएं (Separator के साथ)
      setCloudLink(uploadedLinks.join("   |   ")); 
      
    } catch (err: any) {
      console.error(err);
      setTransferSpeed('Error: ' + err.message);
      alert('Error: ' + err.message);
    } finally {
      setIsUploadingCloud(false);
    }
  };
