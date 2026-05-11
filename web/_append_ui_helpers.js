// UI helpers appended by assistant
function openModal(htmlContent) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  if (!backdrop || !modal) return;
  modal.innerHTML = htmlContent;
  backdrop.style.display = 'flex';
}
function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  if (!backdrop || !modal) return;
  backdrop.style.display = 'none';
  modal.innerHTML = '';
}

function openCreateAuctionModal() {
  const html = `
    <h3 style="margin-top:0;">Create Auction Item</h3>
    <input id="modal-item-name" placeholder="Nama barang" style="width:100%; margin-bottom:8px;" />
    <input id="modal-item-price" type="number" placeholder="Lowest bid" style="width:100%; margin-bottom:8px;" />
    <input id="modal-item-owner" placeholder="Pemilik" style="width:100%; margin-bottom:8px;" />
    <input id="modal-item-image" placeholder="Image URL (e.g. /images/coin.jpg)" style="width:100%; margin-bottom:8px;" />
    <input id="modal-item-duration" type="number" placeholder="Duration seconds" value="180" style="width:100%; margin-bottom:12px;" />
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button id="modal-cancel" class="btn">Cancel</button>
      <button id="modal-create" class="btn">Create & Open Auction</button>
    </div>
  `;
  openModal(html);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-create').addEventListener('click', () => {
    const name = document.getElementById('modal-item-name').value.trim();
    const starting_price = Number(document.getElementById('modal-item-price').value || 0);
    const owner = document.getElementById('modal-item-owner').value.trim();
    const image_url = document.getElementById('modal-item-image').value.trim() || DEFAULT_ITEM_IMAGE;
    const duration_seconds = Number(document.getElementById('modal-item-duration').value || 180);
    if (!name || !Number.isFinite(starting_price) || starting_price <= 0) {
      alert('Nama barang dan lowest bid (angka > 0) wajib diisi');
      return;
    }
    publishCommand('create_auction', { name, starting_price, owner, image_url, duration_seconds });
    closeModal();
  });
}

function openLoginModal() {
  const html = `
    <h3 style="margin-top:0;">Login</h3>
    <input id="modal-login-username" placeholder="Username" style="width:100%; margin-bottom:8px;" />
    <input id="modal-login-password" type="password" placeholder="Password" style="width:100%; margin-bottom:12px;" />
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button id="modal-login-cancel" class="btn">Cancel</button>
      <button id="modal-login-submit" class="btn">Login</button>
    </div>
  `;
  openModal(html);
  document.getElementById('modal-login-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-login-submit').addEventListener('click', () => {
    const username = document.getElementById('modal-login-username').value.trim();
    const password = document.getElementById('modal-login-password').value;
    if (!username || !password) { alert('Isi username & password'); return; }
    publishCommand('login', { username, password });
    closeModal();
  });
}

function openRegisterModal() {
  const html = `
    <h3 style="margin-top:0;">Register</h3>
    <input id="modal-reg-username" placeholder="Username" style="width:100%; margin-bottom:8px;" />
    <input id="modal-reg-password" type="password" placeholder="Password" style="width:100%; margin-bottom:12px;" />
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button id="modal-reg-cancel" class="btn">Cancel</button>
      <button id="modal-reg-submit" class="btn">Register</button>
    </div>
  `;
  openModal(html);
  document.getElementById('modal-reg-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-reg-submit').addEventListener('click', () => {
    const username = document.getElementById('modal-reg-username').value.trim();
    const password = document.getElementById('modal-reg-password').value;
    if (!username || !password) { alert('Isi username & password'); return; }
    publishCommand('register', { username, password });
    closeModal();
  });
}

function doLogout() {
  token = '';
  showResponseStatus('Logged out');
  logActivity('USER: logged out');
}

// wire auth UI toggles and modal triggers after DOM ready
function wireAuthAndModals() {
  const authBtn = document.getElementById('auth-btn');
  const authMenu = document.getElementById('auth-menu');
  if (authBtn) {
    authBtn.addEventListener('click', () => {
      if (!authMenu) return;
      authMenu.style.display = authMenu.style.display === 'block' ? 'none' : 'block';
    });
  }
  const btnLogin = document.getElementById('btn-login');
  const btnRegister = document.getElementById('btn-register');
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogin) btnLogin.addEventListener('click', openLoginModal);
  if (btnRegister) btnRegister.addEventListener('click', openRegisterModal);
  if (btnLogout) btnLogout.addEventListener('click', doLogout);

  const modalBackdrop = document.getElementById('modal-backdrop');
  if (modalBackdrop) modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });
}

// wire center join/bid buttons
function wireCenterControls() {
  const btnJoinCenter = document.getElementById('btn-join-current');
  if (btnJoinCenter) btnJoinCenter.addEventListener('click', () => {
    const auctionId = dom.joinAuctionId.value.trim() || activeAuctionId;
    if (!auctionId) { alert('No auction to join'); return; }
    publishCommand('join_auction', { auction_id: auctionId, token });
  });

  const btnPlaceBid = document.getElementById('btn-place-bid');
  if (btnPlaceBid) btnPlaceBid.addEventListener('click', () => {
    const auctionId = dom.joinAuctionId.value.trim() || activeAuctionId;
    const amount = Number(document.getElementById('my-bid-amount').value || 0);
    if (!auctionId) { alert('No auction to bid on'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { alert('Enter valid bid amount'); return; }
    publishCommand('place_bid', { auction_id: auctionId, bidder_name: demoUser, amount, token });
  });
}

// call wiring after small delay to ensure DOM elements exist
setTimeout(() => { wireAuthAndModals(); wireCenterControls(); }, 500);
