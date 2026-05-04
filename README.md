//to start serial

cd Rest-Assured-Onboarding-main/bridge
npm install
SERIAL_PORT=/dev/tty.usbserial-0001 npm start

//to start server
cd Rest-Assured-Onboarding-main/web
//install python if needed
python3 -m http.server 517
