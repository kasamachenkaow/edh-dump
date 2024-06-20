document.addEventListener('DOMContentLoaded', () => {
    let peer = new Peer();
    let connections = [];
    let isHost = false;
    let eventLog = [];
    let gameState = {
        players: {
            p1: { life: 40 },
            p2: { life: 40 },
            p3: { life: 40 },
            p4: { life: 40 },
        },
        zones: {
            commandZone: [],
            graveyard: [],
            exiledZone: [],
            deck: [],
            hand: [],
            battlefield: []
        },
        turnPhases: "Untap",
    };
    let cardCache = {};

    peer.on('open', id => {
        console.log('My peer ID is: ' + id);
        document.body.insertAdjacentHTML('beforeend', `<div>Peer ID: ${id}</div>`);
    });

    peer.on('connection', conn => {
        connections.push(conn);
        conn.on('data', handleEvent);
        if (isHost) {
            conn.send({ type: 'init', state: gameState });
        }
    });

    document.getElementById('start-hosting').addEventListener('click', () => {
        isHost = true;
        console.log('Hosting game...');
    });

    document.getElementById('join-game').addEventListener('click', () => {
        let gameId = prompt('Enter game ID:');
        if (gameId) {
            let conn = peer.connect(gameId);
            conn.on('data', handleEvent);
            connections.push(conn);
        }
    });

    const gameBoard = document.getElementById('game-board');
    const battlefield = document.getElementById('battlefield');

    async function loadDeck(deckList) {
        const cards = deckList.split('\n').map(line => line.trim()).filter(line => line).map(line => {
            const match = line.match(/^(\d+),\s*(?:"(.+)"|(.+))$/);
            return { quantity: parseInt(match[1]), name: match[2] || match[3] };
        });

        gameState.zones.deck = [];

        for (let card of cards) {
            for (let i = 0; i < card.quantity; i++) {
                const cardData = await fetchCardData(card.name);
                gameState.zones.deck.push(cardData);
            }
            await delay(100); // Ensure rate limit compliance
        }
        renderGameState();
    }

    async function fetchCardData(cardName) {
        if (cardCache[cardName]) {
            return cardCache[cardName];
        }
        const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`);
        const cardData = await response.json();
        cardCache[cardName] = cardData;
        return cardData;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function displayCard(cardData, zoneElement, isDeck = false, position = null) {
        const cardElement = document.createElement('div');
        cardElement.className = 'card';
        if (isDeck) {
            cardElement.classList.add('deck-card');
        }
        cardElement.draggable = true;

        let imageUrl = '';
        if (cardData.image_uris) {
            imageUrl = cardData.image_uris.small;
        } else if (cardData.card_faces && cardData.card_faces.length > 0) {
            imageUrl = cardData.card_faces[0].image_uris.small;
        }

        cardElement.innerHTML = `<img src="${imageUrl}" alt="${cardData.name}" />`;
        cardElement.addEventListener('click', () => showCardPopup(cardData));
        cardElement.addEventListener('dragstart', (e) => dragStart(e, cardData));

        if (position) {
            cardElement.style.position = 'absolute';
            cardElement.style.left = position.x + 'px';
            cardElement.style.top = position.y + 'px';
        }

        zoneElement.appendChild(cardElement);
    }

    function showCardPopup(cardData) {
        const popup = document.createElement('div');
        popup.className = 'card-popup';

        let imageUrl = '';
        if (cardData.image_uris) {
            imageUrl = cardData.image_uris.large;
        } else if (cardData.card_faces && cardData.card_faces.length > 0) {
            imageUrl = cardData.card_faces[0].image_uris.large;
        }

        popup.innerHTML = `
            <img src="${imageUrl}" alt="${cardData.name}" />
            <a href="${cardData.scryfall_uri}" target="_blank">View on Scryfall</a>
        `;
        popup.addEventListener('click', () => popup.remove());
        document.body.appendChild(popup);
    }

    function showDeckInput() {
        document.getElementById('deck-input-popup').style.display = 'block';
    }

    function hideDeckInput() {
        document.getElementById('deck-input-popup').style.display = 'none';
    }

    function loadDeckFromInput() {
        const deckInput = document.getElementById('deck-input').value;
        loadDeck(deckInput);
        hideDeckInput();
    }

    function drawCard() {
        sendEvent({ type: 'drawCard' });
    }

    function shuffleDeck() {
        sendEvent({ type: 'shuffleDeck' });
    }

    function searchDeck() {
        const query = prompt("Enter card name to search:");
        if (query) {
            sendEvent({ type: 'searchDeck', query });
        }
    }

    function putUnderDeck() {
        sendEvent({ type: 'putUnderDeck' });
    }

    function handleEvent(event) {
        if (event.type === 'init') {
            gameState = event.state;
            renderGameState();
        } else {
            eventLog.push(event);
            gameState = reduceEvents(eventLog, gameState);
            renderGameState();
            if (isHost) {
                broadcastEvent(event);
            }
        }
    }

    function sendEvent(event) {
        eventLog.push(event);
        gameState = reduceEvents(eventLog, gameState);
        renderGameState();
        if (isHost) {
            broadcastEvent(event);
        } else {
            connections.forEach(conn => conn.send(event));
        }
    }

    function broadcastEvent(event) {
        connections.forEach(conn => conn.send(event));
    }

    function reduceEvents(events, initialState) {
        let state = { ...initialState };

        for (let event of events) {
            switch (event.type) {
                case 'drawCard':
                    if (state.zones.deck.length > 0) {
                        const drawnCard = state.zones.deck.shift();
                        state.zones.hand.push(drawnCard);
                    }
                    break;
                case 'shuffleDeck':
                    state.zones.deck = shuffleArray(state.zones.deck);
                    break;
                case 'searchDeck':
                    if (state.zones.deck.length > 0) {
                        const foundCards = state.zones.deck.filter(card => card.name.toLowerCase().includes(event.query.toLowerCase()));
                        if (foundCards.length > 0) {
                            alert("Found: " + foundCards.map(card => card.name).join(", "));
                        } else {
                            alert("No cards found.");
                        }
                    }
                    break;
                case 'putUnderDeck':
                    if (state.zones.hand.length > 0) {
                        const card = state.zones.hand.pop();
                        state.zones.deck.push(card);
                    }
                    break;
                case 'moveCard':
                    // Remove the card from its original zone
                    for (let zone in state.zones) {
                        state.zones[zone] = state.zones[zone].filter(c => c.name !== event.card.name);
                    }
                    // Add the card to the new zone
                    state.zones[event.to].push({ ...event.card, position: event.position });
                    break;
                default:
                    break;
            }
        }

        return state;
    }

    function renderGameState() {
        document.getElementById('life-total-p1').textContent = gameState.players.p1.life;
        document.getElementById('life-total-p2').textContent = gameState.players.p2.life;
        document.getElementById('life-total-p3').textContent = gameState.players.p3.life;
        document.getElementById('life-total-p4').textContent = gameState.players.p4.life;
        document.getElementById('turn-phase').textContent = gameState.turnPhases;

        renderZone('command-zone', gameState.zones.commandZone);
        renderZone('graveyard', gameState.zones.graveyard);
        renderZone('exiled-zone', gameState.zones.exiledZone);
        renderZone('deck', gameState.zones.deck, true);  // Deck should be face-down
        renderZone('hand', gameState.zones.hand, false, true);  // Hand should be face-up and draggable
        renderZone('battlefield', gameState.zones.battlefield, false, true, true);  // Battlefield should be face-up, draggable, and freely positioned
    }

    function renderZone(zoneId, cards, isFaceDown = false, isDraggable = false, isFreePosition = false) {
        const zoneElement = document.getElementById(zoneId);
        zoneElement.innerHTML = ''; // Clear existing cards
        cards.forEach(card => {
            const position = isFreePosition ? card.position : null;
            displayCard(card, zoneElement, zoneId === 'deck', position);
        });
    }

    function dragStart(e, card) {
        e.dataTransfer.setData('application/json', JSON.stringify(card));
        e.dataTransfer.effectAllowed = 'move';
    }

    const zones = ['battlefield', 'hand', 'deck', 'graveyard', 'exiled-zone', 'command-zone'];

    zones.forEach(zoneId => {
        const zoneElement = document.getElementById(zoneId);

        zoneElement.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        zoneElement.addEventListener('drop', (e) => {
            e.preventDefault();
            const cardData = JSON.parse(e.dataTransfer.getData('application/json'));
            const position = { x: e.offsetX, y: e.offsetY };
            moveCardToZone(cardData, zoneId, position);
        });
    });

    function moveCardToZone(cardData, zoneId, position = null) {
        // Remove the card from its current zone
        for (let zone in gameState.zones) {
            gameState.zones[zone] = gameState.zones[zone].filter(c => c.name !== cardData.name);
        }
        // Add the card to the new zone
        gameState.zones[zoneId].push({ ...cardData, position });
        renderGameState();
        sendEvent({ type: 'moveCard', card: cardData, to: zoneId, position });
    }

    window.showDeckInput = showDeckInput;
    window.hideDeckInput = hideDeckInput;
    window.loadDeckFromInput = loadDeckFromInput;
    window.drawCard = drawCard;
    window.shuffleDeck = shuffleDeck;
    window.searchDeck = searchDeck;
    window.putUnderDeck = putUnderDeck;
});
