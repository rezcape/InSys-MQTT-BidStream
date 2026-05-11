// cd insys && cd InSys-MQTT-BidStream && clear && ls

Terminal 1 : 
npm run setup
cp .env.example .env

chmod +x node_modules/.bin/concurrently
chmod -R u+x node_modules/.bin
chmod +x node_modules/ts-node-dev/lib/bin.js

npm run dev:stack

Terminal 2 : 
mosquitto_sub -h broker.hivemq.com -t auction/item/+/status -v

Terminal 3 : 
mosquitto_sub -h broker.hivemq.com -t auction/item/+/events -v

Terminal 4 : 
mosquitto_sub -h broker.hivemq.com -t auction/item/+/bid/highest -v

Terminal 5 : 
mosquitto_sub -h broker.hivemq.com -t client/tester01/result/+ -v

Terminal 6 : 
mosquitto_sub -h broker.hivemq.com -t client/tester01/error -v

---

Terminal 7 : 
mosquitto_pub -h broker.hivemq.com -t client/tester01/command/register -m '{"username":"tester01","password":"password123"}'
mosquitto_pub -h broker.hivemq.com -t client/tester01/command/login -m '{"username":"tester01","password":"password123"}'
mosquitto_pub -h broker.hivemq.com -t client/tester01/command/get_items -m '{}'
mosquitto_pub -h broker.hivemq.com -t client/tester01/command/open_auction -m '{"item_id":"ISI_ITEM_ID","duration_seconds":120,"token":"ISI_TOKEN_LOGIN"}'
mosquitto_pub -h broker.hivemq.com -t client/tester01/command/join_auction -m '{"auction_id":"ISI_AUCTION_ID","token":"ISI_TOKEN_LOGIN"}'
mosquitto_pub -h broker.hivemq.com -t client/tester01/command/place_bid -m '{"auction_id":"ISI_AUCTION_ID","bidder_name":"tester01","amount":500000,"token":"ISI_TOKEN_LOGIN"}'

Terminal 8 : 
npm run dev:web