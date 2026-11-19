#!/data/data/com.termux/files/usr/bin/bash
echo ""
echo "============================================="
echo "  [*] Webyog serve..."
echo "============================================="
echo ""
node ./server/src/index.js & 2>/dev/null
cd ./client 
npm run dev &&

echo "Stopping webyog serve..."
pkill -9 -f "node" 2>/dev/null
echo "Done..."
	
