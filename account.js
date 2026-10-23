(() => {
  const layer = document.querySelector('#commerceLayer');
  if (!layer) return;
  let activeDashboardUser = null;
  let customerOrdersCache = null;
  let adminDataCache = null;
  let editorMedia = [];
  let editorVariants = [];
  const apiBase = (document.querySelector('meta[name="rollcall-api-base"]')?.content || '').replace(/\/$/, '');
  const apiUrl = url => `${apiBase}${url}`;
  try { window.rollcallSessionToken ||= sessionStorage.getItem('rollcall-session-token') || ''; } catch {}
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (value, currency = 'USD') => currency === 'KES' ? `KSh ${(Number(value || 0) / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : `$${(Number(value || 0) / 100).toFixed(2)} USD`;
  const editorMoney = value => `$${Number(value || 0).toFixed(2)}`;
  const normalizeMedia = product => Array.isArray(product.media) && product.media.length ? product.media : (product.image ? [{ type: 'image', src: product.image, name: 'Product image' }] : []);
  const mediaMarkup = () => editorMedia.map((media, index) => `<article class="editor-media-card"><div class="editor-media-preview">${media.type === 'video' ? `<video src="${escape(media.src)}" muted playsinline preload="metadata"></video><span class="editor-video-tag">VIDEO</span>` : `<img src="${escape(media.src)}" alt="${escape(media.name || `Product image ${index + 1}`)}">`}<span class="editor-media-index">${String(index + 1).padStart(2, '0')}</span></div><div class="editor-media-meta"><strong>${escape(media.name || `Product ${media.type}`)}</strong><small>${media.type === 'video' ? 'VIDEO CLIP' : 'IMAGE'} · GALLERY MEDIA</small></div><div class="editor-media-controls"><button type="button" data-media-move="${index}" data-direction="-1" aria-label="Move media earlier" ${index === 0 ? 'disabled' : ''}>←</button><button type="button" data-media-move="${index}" data-direction="1" aria-label="Move media later" ${index === editorMedia.length - 1 ? 'disabled' : ''}>→</button><button type="button" class="editor-remove" data-media-remove="${index}">REMOVE</button></div></article>`).join('');
  const variantMarkup = () => editorVariants.map((variant, index) => `<article class="variant-editor-card" data-variant-index="${index}"><div class="variant-editor-head"><span>VARIANT ${String(index + 1).padStart(2, '0')}</span><button type="button" data-variant-remove="${index}" aria-label="Remove variant">×</button></div><div class="variant-fields"><label>VARIANT NAME<input data-variant-field="name" value="${escape(variant.name || '')}" placeholder="8.25 in · Black" required></label><label>PRICE OVERRIDE <small>USD · blank uses base price</small><input data-variant-field="price" type="number" min="1" step="0.01" value="${escape(variant.price ?? '')}" placeholder="Base price"></label><label>STOCK OVERRIDE <small>blank uses base stock</small><input data-variant-field="stock" type="number" min="0" step="1" value="${escape(variant.stock ?? '')}" placeholder="Base stock"></label><fieldset class="variant-media-select"><legend>VARIANT IMAGE</legend><input type="hidden" data-variant-field="mediaIndex" value="${Number(variant.mediaIndex ?? -1)}"><div class="variant-image-choices"><button type="button" class="variant-image-choice ${Number(variant.mediaIndex ?? -1) < 0 ? 'is-selected' : ''}" data-variant-image="${index}" data-media-index="-1" aria-label="Use main product image"><span class="variant-image-main">MAIN</span></button>${editorMedia.map((media, mediaIndex) => ({ media, mediaIndex })).filter(({ media }) => media.type === 'image').map(({ media, mediaIndex }) => `<button type="button" class="variant-image-choice ${Number(variant.mediaIndex) === mediaIndex ? 'is-selected' : ''}" data-variant-image="${index}" data-media-index="${mediaIndex}" aria-label="Use product image ${mediaIndex + 1}" title="Image ${mediaIndex + 1}"><img src="${escape(media.src)}" alt=""></button>`).join('')}</div></fieldset></div></article>`).join('');
  const syncVariants = form => { if (!form) return; form.querySelectorAll('[data-variant-index]').forEach(card => { const variant = editorVariants[Number(card.dataset.variantIndex)]; if (!variant) return; card.querySelectorAll('[data-variant-field]').forEach(field => { variant[field.dataset.variantField] = field.value; }); }); };
  const productEditorMarkup = product => {
    editorMedia = normalizeMedia(product).map(item => ({ type: item.type === 'video' ? 'video' : 'image', src: item.src, name: item.name || '' }));
    editorVariants = Array.isArray(product.variants) ? product.variants.map(item => ({ id: item.id || '', name: item.name || '', option: item.option || '', price: item.price ?? '', stock: item.stock ?? '', mediaIndex: item.mediaIndex ?? -1 })) : [];
    const features = Array.isArray(product.features) ? product.features.join('\n') : '';
    return `<section class="dash-panel product-editor-panel"><div class="editor-intro"><div><p class="dash-kicker">CATALOG / PRODUCT STUDIO</p><h3>${product.id ? 'Tune this board.' : 'Build a new drop.'}</h3><p>Everything for this product, organized in one clean workspace.</p></div><button type="button" class="dash-secondary" data-admin-tab="products">← Back to products</button></div><form class="admin-new-product product-studio-form" data-admin-product-form data-product-id="${escape(product.id || '')}"><input type="hidden" name="rating" value="${escape(product.rating || 'NEW')}"><section class="editor-section editor-product-basics"><div class="editor-section-title"><span>01</span><div><h4>Product information</h4><p>The essential details customers use to choose their ride.</p></div></div><div class="editor-fields"><label>PRODUCT NAME<input name="name" value="${escape(product.name || '')}" placeholder="After Hours Cruiser" required minlength="2"></label><label>CATEGORY / SIZE<input name="category" value="${escape(product.category || '')}" placeholder="COMPLETE / CRUISER" required></label><label>BASE PRICE · USD<input name="price" type="number" min="1" step="0.01" value="${escape(product.price ?? '')}" required></label><label>BASE STOCK<input name="stock" type="number" min="0" step="1" value="${escape(product.stock ?? '')}" required></label><label>SHOP BADGE<input name="badge" value="${escape(product.badge || '')}" placeholder="PARK FAVORITE"></label><label>ESTIMATED SHIPPING TIME<input name="shippingTime" value="${escape(product.shippingTime || '')}" placeholder="3–5 business days"><small>Shown to customers as an estimated delivery window.</small></label><label>SHORT DESCRIPTION<input name="description" value="${escape(product.description || '')}" placeholder="A quick line that earns a second look." required></label><label class="editor-full-field editor-story-field">PRODUCT DETAILS <small>Full product story · no character cap</small><textarea name="details" rows="8" placeholder="Materials, construction, ride feel, ideal terrain, and what makes this board special…">${escape(product.details || product.description || '')}</textarea></label><label class="editor-full-field">FEATURES <small>Unlimited highlights · one per line · 120 characters each</small><textarea name="featuresText" rows="4" placeholder="Canadian maple, 7-ply\nResponsive street concave\nPressed for everyday sessions">${escape(features)}</textarea></label><label class="editor-full-field">SHIPPING COUNTRIES <small>Comma separated · blank allows worldwide</small><input name="shippingCountries" value="${escape((product.shippingCountries || []).join(', '))}" placeholder="Kenya, Uganda, Tanzania"></label></div></section><section class="editor-section"><div class="editor-section-title"><span>02</span><div><h4>Media library</h4><p>Upload a sequence of images and clips. First item becomes the shop cover.</p></div><label class="editor-upload-button">＋ Add media<input type="file" data-media-upload accept="image/*,video/*" multiple hidden></label></div><div class="editor-url-add"><label>OR ADD A MEDIA URL<input type="url" data-media-url placeholder="https://…" inputmode="url"></label><label>MEDIA TYPE<select data-media-url-type><option value="image">IMAGE</option><option value="video">VIDEO</option></select></label><button type="button" class="dash-secondary" data-media-add-url>Add URL ↗</button></div><div class="editor-upload-note">NO ITEM LIMIT · FILES UP TO 3 MB EACH / 4.5 MB UPLOAD DATA PER PRODUCT · USE URLS FOR LARGER GALLERIES</div><div class="editor-media-list" data-media-list>${mediaMarkup() || '<div class="editor-media-empty">Your gallery is waiting. Add images or a short product clip.</div>'}</div><p class="editor-media-error" role="alert" hidden></p></section><section class="editor-section"><div class="editor-section-title"><span>03</span><div><h4>Variants &amp; options</h4><p>Offer sizes, colors, or other choices with their own availability and gallery image.</p></div><button class="dash-secondary" type="button" data-variant-add>＋ Add variant</button></div><div class="variant-editor-list" data-variant-list>${variantMarkup() || '<div class="editor-variant-empty">No options needed? This product will use its base price and stock.</div>'}</div></section><p class="account-error" role="alert" hidden></p><div class="admin-form-actions editor-submit-row"><button type="button" class="dash-secondary" data-admin-tab="products">Cancel</button><button type="submit" class="dash-primary">${product.id ? 'Save product changes' : 'Publish this product'} <span>↗</span></button></div></form></section>`;
  };
  const show = html => { layer.innerHTML = `<div class="commerce-scrim" data-account-close></div>${html}`; layer.classList.add('is-open'); layer.setAttribute('aria-hidden', 'false'); document.body.classList.add('commerce-open'); };
  const close = () => { layer.classList.remove('is-open'); layer.setAttribute('aria-hidden', 'true'); document.body.classList.remove('commerce-open'); layer.innerHTML = ''; };
  const setError = (node, message) => { const target = node.querySelector('.account-error'); if (target) { target.hidden = !message; target.textContent = message || ''; } };
  const passwordField = (autocomplete = 'current-password', minLength = 1) => `<label>Password<span class="password-input"><input name="password" type="password" autocomplete="${autocomplete}" required minlength="${minLength}"><button class="password-toggle" type="button" data-toggle-password aria-label="Show password" aria-pressed="false">SHOW</button></span>${minLength > 1 ? '<small>Use at least 10 characters.</small>' : ''}</label>`;
  function showForgotHelp(form, message) {
    setError(form, message);
    const target = form.querySelector('.account-error'); if (!target) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'account-resend'; button.dataset.forgotPassword = ''; button.textContent = 'RESET PASSWORD ↗';
    target.append(document.createElement('br'), button);
  }
  function showVerificationHelp(form, message) {
    setError(form, message);
    const target = form.querySelector('.account-error');
    if (!target) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'account-resend'; button.dataset.resendVerification = '';
    button.textContent = 'RESEND VERIFICATION EMAIL ↗';
    target.append(document.createElement('br'), button);
  }
  async function api(url, options = {}) {
    if (location.protocol !== 'http:' && location.protocol !== 'https:' && !apiBase) throw new Error('Set the rollcall-api-base meta tag to your backend URL to use the account from a local file.');
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (window.rollcallSessionToken) headers.Authorization = `Bearer ${window.rollcallSessionToken}`;
    const response = await fetch(apiUrl(url), { credentials: apiBase ? 'include' : 'same-origin', ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (result.sessionToken) { window.rollcallSessionToken = result.sessionToken; try { sessionStorage.setItem('rollcall-session-token', result.sessionToken); } catch {} }
    if (url === '/api/auth/logout' && response.ok) { window.rollcallSessionToken = ''; try { sessionStorage.removeItem('rollcall-session-token'); } catch {} }
    if (!response.ok) {
      const error = new Error(result.error || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function authView(mode = 'login', message = '', noticeType = 'error') {
    const registering = mode === 'register';
    show(`<section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><button class="commerce-close" type="button" data-account-close aria-label="Close account">×</button><p class="detail-category">ROLL CALL / YOUR ACCOUNT</p><h2 id="accountTitle">${registering ? 'Make it yours.' : 'Welcome back.'}</h2><p class="account-lead">${registering ? 'Join the crew. Track your orders and keep your next session close.' : 'Sign in to see your orders and keep rolling.'}</p><form class="account-form" data-auth-form="${registering ? 'register' : 'login'}">${registering ? '<label>Your name<input name="name" autocomplete="name" required minlength="2"></label>' : ''}<label>Email address<input name="email" type="email" autocomplete="email" required></label>${passwordField(registering ? 'new-password' : 'current-password', registering ? 10 : 1)}<p class="account-error" role="alert" hidden></p><button class="button button-dark account-submit" type="submit">${registering ? 'CREATE ACCOUNT' : 'SIGN IN'} <span>↗</span></button></form>${message ? `<p class="${noticeType === 'success' ? 'account-notice' : 'account-error'}" role="${noticeType === 'success' ? 'status' : 'alert'}">${escape(message)}</p>` : ''}${registering ? '' : '<p class="account-switch"><button type="button" data-forgot-password>Forgot your password?</button></p>'}<p class="account-switch">${registering ? 'Already part of the crew?' : 'New around here?'} <button type="button" data-auth-mode="${registering ? 'login' : 'register'}">${registering ? 'Sign in' : 'Create an account'}</button></p><p class="account-privacy">Your account is protected with encrypted sessions. We never store payment card details.</p></section>`);
  }
  function resetRequestView(email = '') {
    show(`<section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><button class="commerce-close" type="button" data-account-close aria-label="Close account">×</button><p class="detail-category">ROLL CALL / ACCOUNT RECOVERY</p><h2 id="accountTitle">Get back in.</h2><p class="account-lead">We’ll send a secure link if an account matches that email.</p><form class="account-form" data-reset-request><label>Email address<input name="email" type="email" autocomplete="email" required value="${escape(email)}"></label><p class="account-error" role="status" hidden></p><button class="button button-dark account-submit" type="submit">SEND RESET LINK <span>↗</span></button></form><p class="account-switch"><button type="button" data-auth-mode="login">Back to sign in</button></p></section>`);
  }
  function resetPasswordView() {
    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';
    show(`<section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><button class="commerce-close" type="button" data-account-close aria-label="Close account">×</button><p class="detail-category">ROLL CALL / ACCOUNT RECOVERY</p><h2 id="accountTitle">New password.</h2><p class="account-lead">Choose a fresh password with at least 10 characters.</p><form class="account-form" data-reset-complete><input type="hidden" name="token" value="${escape(token)}">${passwordField('new-password', 10)}<p class="account-error" role="alert" hidden></p><button class="button button-dark account-submit" type="submit">UPDATE PASSWORD <span>↗</span></button></form></section>`);
  }
  async function dashboard(user, profileMessage = '', tab = 'overview', editing = false) {
    if (user.role === 'admin') return adminDashboard(user, 'overview', null, profileMessage);
    activeDashboardUser = user;
    const profile = user.profile || {};
    const { orders = [] } = customerOrdersCache || (customerOrdersCache = await api('/api/account/orders'));
    const paid = orders.filter(order => order.status === 'paid' || order.status === 'processing' || order.status === 'shipped' || order.status === 'delivered');
    const active = orders.filter(order => !['delivered', 'cancelled'].includes(order.status));
    const statusPill = status => `<span class="status-pill status-${escape(status).toLowerCase()}">${escape(status)}</span>`;
    const orderCard = order => `<article class="dash-order-card"><div class="dash-order-top"><span>${escape(order.orderNumber)}</span>${statusPill(order.status)}</div><p>${escape(order.items.map(item => `${item.name}${item.variantName ? ` · ${item.variantName}${item.variantOption && item.variantOption !== item.variantName ? ` / ${item.variantOption}` : ''}` : ''} × ${item.quantity}`).join(' · '))}</p><div class="dash-order-bottom"><small>${new Date(order.createdAt).toLocaleDateString()}</small><strong>${money(order.amountSubunit, order.currency)}</strong></div></article>`;
    const nav = `<nav class="dashboard-nav" aria-label="Account sections"><button type="button" data-customer-tab="overview" class="${tab === 'overview' ? 'is-active' : ''}">Overview</button><button type="button" data-customer-tab="orders" class="${tab === 'orders' ? 'is-active' : ''}">My orders <span>${orders.length}</span></button><button type="button" data-customer-tab="details" class="${tab === 'details' ? 'is-active' : ''}">My details</button></nav>`;
    const detailValues = [['Full name', user.name], ['Email', user.email], ['Phone', profile.phone], ['Delivery address', [profile.address, profile.city, profile.region, profile.postalCode, profile.country].filter(Boolean).join(', ')]];
    let content = '';
    if (tab === 'details' && editing) {
      content = `<section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">PROFILE SETTINGS</p><h3>Edit your details</h3><p>Save your delivery information for a quicker checkout next time.</p></div><button type="button" class="dash-secondary" data-customer-tab="details">Cancel</button></div><form class="account-profile-form" data-profile-form><div class="profile-fields"><label>FULL NAME<input name="name" autocomplete="name" value="${escape(user.name)}" required minlength="2"></label><label>EMAIL ADDRESS<input type="email" value="${escape(user.email)}" readonly aria-readonly="true"><small>Email is tied to your account and can’t be edited here.</small></label><label>PHONE NUMBER<input name="phone" type="tel" autocomplete="tel" value="${escape(profile.phone || '')}" placeholder="For delivery updates"></label><label>STREET ADDRESS<input name="address" autocomplete="street-address" value="${escape(profile.address || '')}" placeholder="House number and street"></label><label>CITY<input name="city" autocomplete="address-level2" value="${escape(profile.city || '')}"></label><label>STATE / REGION<input name="region" autocomplete="address-level1" value="${escape(profile.region || '')}"></label><label>POSTAL CODE<input name="postalCode" autocomplete="postal-code" value="${escape(profile.postalCode || '')}"></label><label>COUNTRY<input name="country" autocomplete="country-name" value="${escape(profile.country || '')}"></label></div><p class="account-error" role="alert" hidden></p><button class="button button-dark profile-save" type="submit">SAVE MY DETAILS <span>↗</span></button></form></section>`;
    } else if (tab === 'details') {
      content = `<section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">YOUR PROFILE</p><h3>Personal details</h3><p>Your contact and delivery details, ready when you are.</p></div><button type="button" class="dash-primary" data-edit-profile>Edit details <span>↗</span></button></div><div class="profile-summary-grid">${detailValues.map(([label, value]) => `<article><span>${label}</span><strong>${escape(value || 'Not added yet')}</strong></article>`).join('')}</div></section>`;
    } else if (tab === 'orders') {
      content = `<section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">ORDER HISTORY</p><h3>Every session starts somewhere.</h3><p>Track the boards you’ve picked up from the shop.</p></div></div>${orders.length ? `<div class="dash-order-list">${orders.map(orderCard).join('')}</div>` : '<div class="dash-empty"><span>✳</span><strong>No orders yet</strong><p>Your next good day is one board away.</p><button class="dash-primary" type="button" data-start-shopping>Browse boards ↗</button></div>'}</section>`;
    } else {
      const latest = orders.slice(0, 3);
      const savedAddress = [profile.address, profile.city, profile.region].filter(Boolean).join(', ');
      const spentUsd = paid.filter(order => order.currency !== 'KES').reduce((sum, order) => sum + Number(order.amountSubunit || 0), 0);
      const spentKes = paid.filter(order => order.currency === 'KES').reduce((sum, order) => sum + Number(order.amountSubunit || 0), 0);
      content = `<div class="dash-metrics"><article class="dash-metric dash-metric-accent"><span>ORDERS PLACED</span><strong>${orders.length.toString().padStart(2, '0')}</strong><small>Good days in the making</small></article><article class="dash-metric"><span>IN MOTION</span><strong>${active.length.toString().padStart(2, '0')}</strong><small>Orders not yet delivered</small></article><article class="dash-metric"><span>SPENT WITH ROLL CALL</span><strong>${money(spentUsd, 'USD')}</strong><small>${money(spentKes, 'KES')} · ${paid.length} paid orders</small></article></div><div class="dash-content-grid"><section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">LATEST ACTIVITY</p><h3>Your orders</h3></div><button type="button" class="dash-text-button" data-customer-tab="orders">See all <span>↗</span></button></div>${latest.length ? `<div class="dash-order-list">${latest.map(orderCard).join('')}</div>` : '<div class="dash-empty dash-empty-inline"><span>✳</span><strong>Your first board is waiting.</strong><p>Pick a ride and we’ll take it from here.</p><button class="dash-primary" type="button" data-start-shopping>Explore the shop ↗</button></div>'}</section><aside class="dash-panel dash-profile-card"><p class="dash-kicker">YOUR PROFILE</p><div class="profile-avatar">${escape(user.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase())}</div><h3>${escape(user.name)}</h3><p>${escape(user.email)}</p><div class="profile-card-detail"><span>DELIVERY ADDRESS</span><strong>${escape(savedAddress || 'Add your address for faster checkout')}</strong></div><div class="profile-card-detail"><span>ACCOUNT STATUS</span><strong>${user.emailVerified ? 'Email verified' : 'Verification pending'}</strong></div><button type="button" class="dash-secondary" data-customer-tab="details">View details ↗</button></aside></div>`;
    }
    show(`<section class="account-panel account-dashboard" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><button class="commerce-close" type="button" data-account-close aria-label="Close account">×</button><div class="dash-brandline"><span><i></i> ROLL CALL / MEMBER SPACE</span><button type="button" class="account-logout" data-logout>Sign out ↗</button></div><header class="dash-page-heading"><div><p class="dash-kicker">YOUR ACCOUNT</p><h2 id="accountTitle">Hey, ${escape(user.name.split(' ')[0])}<span>.</span></h2><p>${user.emailVerified ? 'Your boards, orders, and details in one place.' : 'Your account is ready. Check your inbox to verify your email.'}</p></div><div class="dash-avatar-small">${escape(user.name.slice(0, 1).toUpperCase())}</div></header>${profileMessage ? `<p class="account-notice" role="status">${escape(profileMessage)}</p>` : ''}${nav}<div class="dashboard-content">${content}</div></section>`);
  }
  async function adminDashboard(user, tab = 'overview', editorProduct = null, notice = '') {
    activeDashboardUser = user;
    const [summary, orderData, productData, userData] = adminDataCache || (adminDataCache = await Promise.all([api('/api/admin/summary'), api('/api/admin/orders'), api('/api/admin/products'), api('/api/admin/users')]));
    const orders = orderData.orders || []; const products = productData.products || []; const users = userData.users || [];
    const nav = `<nav class="dashboard-nav admin-nav" aria-label="Store sections"><button type="button" data-admin-tab="overview" class="${tab === 'overview' ? 'is-active' : ''}">Overview</button><button type="button" data-admin-tab="orders" class="${tab === 'orders' ? 'is-active' : ''}">Orders <span>${orders.length}</span></button><button type="button" data-admin-tab="products" class="${tab === 'products' ? 'is-active' : ''}">Products <span>${products.length}</span></button><button type="button" data-admin-tab="customers" class="${tab === 'customers' ? 'is-active' : ''}">Customers <span>${users.length}</span></button></nav>`;
    const orderCard = order => `<article class="admin-order-card"><div class="admin-order-main"><span class="admin-order-mark">↗</span><div><strong>${escape(order.orderNumber)}</strong><small>${escape(order.email)} · ${new Date(order.createdAt).toLocaleDateString()}</small></div></div><div class="admin-order-items">${escape(order.items.map(item => `${item.name}${item.variantName ? ` · ${item.variantName}${item.variantOption && item.variantOption !== item.variantName ? ` / ${item.variantOption}` : ''}` : ''} × ${item.quantity}`).join(' · '))}</div><strong class="admin-order-total">${money(order.amountSubunit, order.currency)}</strong><label class="sr-only" for="order-${escape(order.id)}">Update order ${escape(order.orderNumber)}</label><select id="order-${escape(order.id)}" data-order-status="${escape(order.id)}" aria-label="Order status for ${escape(order.orderNumber)}"><option value="${escape(order.status)}">${escape(order.status)}</option>${['processing','shipped','delivered','cancelled'].filter(status => status !== order.status).map(status => `<option value="${status}">${status}</option>`).join('')}</select></article>`;
    const productCards = products.map(product => { const cover = normalizeMedia(product).find(item => item.type !== 'video')?.src || product.image; return `<article class="admin-product-card"><img src="${escape(cover)}" alt="" loading="lazy"><div class="admin-product-copy"><span>${escape(product.category || 'SKATEBOARD')}</span><strong>${escape(product.name)}</strong><small>${Number(product.stock || 0)} in stock · ${money(Math.round(Number(product.price || 0) * 100))}${product.variants?.length ? ` · ${product.variants.length} options` : ''}</small></div><div class="admin-product-actions"><button type="button" class="dash-secondary" data-edit-product="${escape(product.id)}">Edit <span>↗</span></button><button type="button" class="dash-secondary product-delete" data-delete-product="${escape(product.id)}" data-product-name="${escape(product.name)}">Delete</button></div></article>`; }).join('');
    const customerRows = users.map(item => `<article class="admin-customer-card"><div class="customer-initial">${escape(item.name.slice(0, 1).toUpperCase())}</div><div><strong>${escape(item.name)}</strong><span>${escape(item.email)}</span></div><small class="${item.emailVerified ? 'customer-verified' : ''}">${item.emailVerified ? 'VERIFIED' : 'PENDING'}</small></article>`).join('');
    let content = '';
    if (tab === 'product-editor') {
      const product = editorProduct || {};
      content = productEditorMarkup(product);
    } else if (tab === 'orders') {
      content = `<section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">FULFILLMENT</p><h3>Order desk</h3><p>Review purchases and keep each delivery moving.</p></div></div><div class="admin-order-list">${orders.map(orderCard).join('') || '<div class="dash-empty"><strong>Orders will land here.</strong><p>When a customer checks out, you’ll see it in this order desk.</p></div>'}</div></section>`;
    } else if (tab === 'products') {
      content = `<section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">THE SHOP FLOOR</p><h3>Product catalog</h3><p>${products.length} products live in your store.</p></div><button type="button" class="dash-primary" data-add-product>Add product <span>＋</span></button></div><div class="admin-product-list">${productCards || '<div class="dash-empty"><strong>Your catalog is ready for its first board.</strong><p>Add products to make them available in the storefront.</p></div>'}</div></section>`;
    } else if (tab === 'customers') {
      content = `<section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">THE CREW</p><h3>Customer list</h3><p>${users.length} accounts are part of the community.</p></div></div><div class="admin-customer-list">${customerRows || '<div class="dash-empty"><strong>No customers yet.</strong><p>Customer accounts will appear here.</p></div>'}</div></section>`;
    } else {
      const recentOrders = orders.slice(0, 4);
      const lowStock = products.filter(product => Number(product.stock || 0) <= 3).length;
      content = `<div class="dash-metrics admin-dash-metrics"><article class="dash-metric dash-metric-accent"><span>GROSS REVENUE</span><strong>${money(summary.revenueByCurrency?.USD || 0, 'USD')}</strong><small>${money(summary.revenueByCurrency?.KES || 0, 'KES')} · successful payments</small></article><article class="dash-metric"><span>ALL ORDERS</span><strong>${Number(summary.orders).toString().padStart(2, '0')}</strong><small>${summary.pending} awaiting payment</small></article><article class="dash-metric"><span>PRODUCTS</span><strong>${Number(summary.products).toString().padStart(2, '0')}</strong><small>${lowStock ? `${lowStock} low on stock` : 'Inventory looking good'}</small></article><article class="dash-metric"><span>CUSTOMERS</span><strong>${Number(summary.users).toString().padStart(2, '0')}</strong><small>Store community</small></article></div><div class="dash-content-grid admin-overview-grid"><section class="dash-panel"><div class="dash-section-heading"><div><p class="dash-kicker">JUST IN</p><h3>Recent orders</h3></div><button type="button" class="dash-text-button" data-admin-tab="orders">Open order desk ↗</button></div><div class="admin-order-list">${recentOrders.map(orderCard).join('') || '<div class="dash-empty dash-empty-inline"><strong>No orders yet</strong><p>Customer orders will show up here.</p></div>'}</div></section><aside class="dash-panel admin-quick-panel"><p class="dash-kicker">QUICK ACTION</p><div class="quick-action-mark">＋</div><h3>New drop?</h3><p>Add a board to the catalog and it’ll be ready for the storefront.</p><button type="button" class="dash-primary" data-add-product>Add a product <span>↗</span></button><div class="quick-stock"><span>LOW STOCK WATCH</span><strong>${lowStock ? `${lowStock} products need a restock` : 'All products have healthy stock'}</strong></div></aside></div>`;
    }
    const adminHeadings = { overview: 'Shop floor', orders: 'Order desk', products: 'The catalog', customers: 'The crew' };
    const heading = tab === 'product-editor' ? (editorProduct ? 'Product editor' : 'New product') : (adminHeadings[tab] || 'Shop floor');
    show(`<section class="account-panel admin-dashboard" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><button class="commerce-close" type="button" data-account-close aria-label="Close admin dashboard">×</button><div class="dash-brandline"><span><i></i> ROLL CALL / CONTROL ROOM</span><div><span class="admin-signed-in">${escape(user.email)}</span><button type="button" class="account-logout" data-logout>Sign out ↗</button></div></div><header class="dash-page-heading"><div><p class="dash-kicker">${tab === 'overview' ? 'STORE OVERVIEW' : 'STORE MANAGEMENT'}</p><h2 id="accountTitle">${heading}<span>.</span></h2><p>Good to see you, ${escape(user.name.split(' ')[0])}. Here’s the latest from Roll Call.</p></div><div class="dash-avatar-small admin-avatar">R</div></header>${nav}${notice ? `<p class="account-notice" role="status">${escape(notice)}</p>` : ''}<div class="dashboard-content">${content}</div></section>`);
  }
  async function openAccount(mode) {
    show('<section class="account-panel account-loading" role="status"><span class="loading-spinner" aria-hidden="true"></span><p>Opening your account…</p></section>');
    try { const { user } = await api('/api/auth/me'); if (user) await dashboard(user); else authView(mode || 'login'); }
    catch (error) { authView('login', error.message); }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-media-url]')) { event.preventDefault(); event.target.closest('.editor-url-add')?.querySelector('[data-media-add-url]')?.click(); }
  });
  document.addEventListener('click', async event => {
    if (event.target.closest('[data-account-open]')) { await openAccount(); return; }
    if (event.target.closest('[data-signin]')) { await openAccount('login'); return; }
    if (event.target.closest('[data-account-close]')) { close(); return; }
    const customerTab = event.target.closest('[data-customer-tab]');
    if (customerTab && activeDashboardUser?.role !== 'admin') { await dashboard(activeDashboardUser, '', customerTab.dataset.customerTab); return; }
    if (event.target.closest('[data-edit-profile]')) { await dashboard(activeDashboardUser, '', 'details', true); return; }
    const adminTab = event.target.closest('[data-admin-tab]');
    if (adminTab && activeDashboardUser?.role === 'admin') { await adminDashboard(activeDashboardUser, adminTab.dataset.adminTab); return; }
    if (event.target.closest('[data-add-product]') && activeDashboardUser?.role === 'admin') { await adminDashboard(activeDashboardUser, 'product-editor'); return; }
    const mediaUrlButton = event.target.closest('[data-media-add-url]');
    if (mediaUrlButton) {
      const form = mediaUrlButton.closest('[data-admin-product-form]'); const input = form.querySelector('[data-media-url]'); const error = form.querySelector('.editor-media-error');
      try {
        const mediaUrl = new URL(input.value.trim()); const type = form.querySelector('[data-media-url-type]').value;
        if (mediaUrl.protocol !== 'https:') throw new Error('Use a secure HTTPS media URL.');
        editorMedia.push({ type, src: mediaUrl.href, name: decodeURIComponent(mediaUrl.pathname.split('/').pop() || (type === 'video' ? 'Product video' : 'Product image')) });
        error.hidden = true; error.textContent = ''; input.value = '';
        form.querySelector('[data-media-list]').innerHTML = mediaMarkup(); syncVariants(form); form.querySelector('[data-variant-list]').innerHTML = variantMarkup() || '<div class="editor-variant-empty">No options needed? This product will use its base price and stock.</div>';
      } catch (uploadError) { error.hidden = false; error.textContent = uploadError.message || 'Enter a valid HTTPS media URL.'; }
      return;
    }
    const variantImage = event.target.closest('[data-variant-image]');
    if (variantImage) { const form = variantImage.closest('[data-admin-product-form]'); syncVariants(form); const variant = editorVariants[Number(variantImage.dataset.variantImage)]; if (!variant) return; variant.mediaIndex = Number(variantImage.dataset.mediaIndex); form.querySelector('[data-variant-list]').innerHTML = variantMarkup(); return; }
    const variantAdd = event.target.closest('[data-variant-add]');
    if (variantAdd) { const form = variantAdd.closest('[data-admin-product-form]'); syncVariants(form); editorVariants.push({ id: crypto.randomUUID(), name: '', option: '', price: '', stock: '', mediaIndex: -1 }); const list = form.querySelector('[data-variant-list]'); list.innerHTML = variantMarkup(); return; }
    const variantRemove = event.target.closest('[data-variant-remove]');
    if (variantRemove) { const form = variantRemove.closest('[data-admin-product-form]'); syncVariants(form); editorVariants.splice(Number(variantRemove.dataset.variantRemove), 1); form.querySelector('[data-variant-list]').innerHTML = variantMarkup() || '<div class="editor-variant-empty">No options needed? This product will use its base price and stock.</div>'; return; }
    const mediaRemove = event.target.closest('[data-media-remove]');
    if (mediaRemove) { const form = mediaRemove.closest('[data-admin-product-form]'); syncVariants(form); const removed = Number(mediaRemove.dataset.mediaRemove); editorMedia.splice(removed, 1); editorVariants.forEach(variant => { const index = Number(variant.mediaIndex); if (index === removed) variant.mediaIndex = -1; else if (index > removed) variant.mediaIndex = index - 1; }); form.querySelector('[data-media-list]').innerHTML = mediaMarkup() || '<div class="editor-media-empty">Your gallery is waiting. Add images or a short product clip.</div>'; form.querySelector('[data-variant-list]').innerHTML = variantMarkup() || '<div class="editor-variant-empty">No options needed? This product will use its base price and stock.</div>'; return; }
    const mediaMove = event.target.closest('[data-media-move]');
    if (mediaMove) { const form = mediaMove.closest('[data-admin-product-form]'); syncVariants(form); const from = Number(mediaMove.dataset.mediaMove); const to = from + Number(mediaMove.dataset.direction); if (to < 0 || to >= editorMedia.length) return; [editorMedia[from], editorMedia[to]] = [editorMedia[to], editorMedia[from]]; editorVariants.forEach(variant => { const index = Number(variant.mediaIndex); if (index === from) variant.mediaIndex = to; else if (index === to) variant.mediaIndex = from; }); form.querySelector('[data-media-list]').innerHTML = mediaMarkup(); form.querySelector('[data-variant-list]').innerHTML = variantMarkup() || '<div class="editor-variant-empty">No options needed? This product will use its base price and stock.</div>'; return; }
    const editProduct = event.target.closest('[data-edit-product]');
    if (editProduct && activeDashboardUser?.role === 'admin') {
      try { const products = adminDataCache?.[2]?.products || (await api('/api/admin/products')).products || []; const product = products.find(item => item.id === editProduct.dataset.editProduct); if (product) await adminDashboard(activeDashboardUser, 'product-editor', product); }
      catch (error) { const target = layer.querySelector('.account-error'); if (target) { target.hidden = false; target.textContent = error.message; } }
      return;
    }
    const deleteProduct = event.target.closest('[data-delete-product]');
    if (deleteProduct && activeDashboardUser?.role === 'admin') {
      if (!window.confirm(`Delete “${deleteProduct.dataset.productName}” from the catalog and database? This cannot be undone.`)) return;
      deleteProduct.disabled = true; deleteProduct.textContent = 'Deleting…';
      try {
        await api(`/api/admin/products/${encodeURIComponent(deleteProduct.dataset.deleteProduct)}`, { method: 'DELETE' });
        adminDataCache = null;
        document.dispatchEvent(new CustomEvent('rollcall:products-updated'));
        await adminDashboard(activeDashboardUser, 'products', null, 'Product deleted from the database and storefront.');
      } catch (error) { deleteProduct.disabled = false; deleteProduct.textContent = 'Delete'; window.alert(`Could not delete product: ${error.message}`); }
      return;
    }
    const resend = event.target.closest('[data-resend-verification]');
    if (resend) {
      const form = layer.querySelector('[data-auth-form="login"]'); const email = form?.querySelector('[name="email"]')?.value.trim();
      if (!email) { form?.querySelector('[name="email"]')?.focus(); return; }
      resend.disabled = true;
      try { const result = await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }); const target = form.querySelector('.account-error'); target.textContent = result.message; }
      catch (error) { const target = form.querySelector('.account-error'); target.textContent = error.message; resend.disabled = false; }
      return;
    }
    const forgot = event.target.closest('[data-forgot-password]');
    if (forgot) { resetRequestView(layer.querySelector('[data-auth-form="login"] [name="email"]')?.value || ''); return; }
    const toggle = event.target.closest('[data-toggle-password]');
    if (toggle) { const input = toggle.closest('.password-input').querySelector('input'); const visible = input.type === 'password'; input.type = visible ? 'text' : 'password'; toggle.textContent = visible ? 'HIDE' : 'SHOW'; toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password'); toggle.setAttribute('aria-pressed', String(visible)); return; }
    const mode = event.target.closest('[data-auth-mode]'); if (mode) { authView(mode.dataset.authMode); return; }
    if (event.target.closest('[data-logout]')) { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); close(); } catch (error) { const message = layer.querySelector('.account-error'); if (message) { message.hidden = false; message.textContent = error.message; } } return; }
    if (event.target.closest('[data-start-shopping]')) { close(); location.hash = 'shop'; return; }
    const saveProduct = event.target.closest('[data-save-product]');
    if (saveProduct) {
      const id = saveProduct.dataset.saveProduct; const row = saveProduct.closest('.admin-product'); const price = Number(row.querySelector(`[data-product-price="${CSS.escape(id)}"]`).value); const stock = Number(row.querySelector(`[data-product-stock="${CSS.escape(id)}"]`).value);
      try { await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ price, stock }) }); saveProduct.textContent = 'SAVED ✓'; setTimeout(() => { if (saveProduct.isConnected) saveProduct.textContent = 'SAVE'; }, 1200); }
      catch (error) { const target = layer.querySelector('.account-error'); target.hidden = false; target.textContent = error.message; }
    }
  });
  document.addEventListener('change', async event => {
    const upload = event.target.closest('[data-media-upload]');
    if (upload) {
      const form = upload.closest('[data-admin-product-form]'); const error = form.querySelector('.editor-media-error'); error.hidden = true; error.textContent = '';
      const files = Array.from(upload.files || []); const existingSize = editorMedia.reduce((sum, item) => sum + (item.src.startsWith('data:') ? Math.ceil((item.src.length || 0) * .75) : 0), 0);
      if (files.some(file => !['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm'].includes(file.type))) { error.hidden = false; error.textContent = 'Use JPG, PNG, WebP, GIF, AVIF, MP4, or WebM files.'; upload.value = ''; return; }
      if (files.some(file => file.size > 3 * 1024 * 1024) || existingSize + files.reduce((sum, file) => sum + file.size, 0) > 4.5 * 1024 * 1024) { error.hidden = false; error.textContent = 'Each uploaded file must be under 3 MB; keep uploaded files in this product under 4.5 MB total. Add larger galleries by URL.'; upload.value = ''; return; }
      upload.disabled = true;
      try {
        const readFile = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ type: file.type.startsWith('video/') ? 'video' : 'image', src: String(reader.result), name: file.name }); reader.onerror = () => reject(new Error(`Could not read ${file.name}.`)); reader.readAsDataURL(file); });
        editorMedia.push(...await Promise.all(files.map(readFile)));
        form.querySelector('[data-media-list]').innerHTML = mediaMarkup(); syncVariants(form); form.querySelector('[data-variant-list]').innerHTML = variantMarkup() || '<div class="editor-variant-empty">No options needed? This product will use its base price and stock.</div>';
      } catch (uploadError) { error.hidden = false; error.textContent = uploadError.message; }
      finally { upload.disabled = false; upload.value = ''; }
      return;
    }
    const select = event.target.closest('[data-order-status]'); if (!select) return;
    try { select.classList.add('is-saving'); await api(`/api/admin/orders/${encodeURIComponent(select.dataset.orderStatus)}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); select.classList.remove('is-saving'); select.classList.add('is-saved'); if (adminDataCache) { const row = adminDataCache[1].orders?.find(order => order.id === select.dataset.orderStatus); if (row) row.status = select.value; } }
    catch (error) { const target = layer.querySelector('.account-error'); target.hidden = false; target.textContent = error.message; }
  });
  document.addEventListener('submit', async event => {
    const profileForm = event.target.closest('[data-profile-form]');
    if (profileForm) {
      event.preventDefault(); const submit = profileForm.querySelector('[type="submit"]'); submit.disabled = true; submit.innerHTML = 'SAVING DETAILS…';
      try {
        const result = await api('/api/account/profile', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(profileForm))) });
        await dashboard(result.user, 'Your details are saved to your Roll Call account and ready for your next checkout.', 'details');
      } catch (error) { setError(profileForm, error.message); submit.disabled = false; submit.innerHTML = 'SAVE MY DETAILS <span>↗</span>'; }
      return;
    }
    const authForm = event.target.closest('[data-auth-form]');
    if (authForm) {
      event.preventDefault(); const submit = authForm.querySelector('[type="submit"]'); submit.disabled = true;
      try {
        const form = Object.fromEntries(new FormData(authForm));
        const result = await api(`/api/auth/${authForm.dataset.authForm}`, { method: 'POST', body: JSON.stringify(form) });
        if (authForm.dataset.authForm === 'register') { authView('login', result.message || 'Welcome to Roll Call. Check your inbox for the verification email.', 'success'); const email = layer.querySelector('[name="email"]'); if (email) email.value = form.email; } else { window.dispatchEvent(new CustomEvent('rollcall:authenticated', { detail: result.user })); await dashboard(result.user, result.loginEmailSent ? 'A sign-in alert was sent to your email.' : result.loginEmailNotice || 'Signed in successfully.'); }
      } catch (error) {
        if (authForm.dataset.authForm === 'register' && error.status === 409) {
          const email = new FormData(authForm).get('email');
          authView('login', 'That email already has an account. Sign in, or choose “Forgot your password?” if you need a new password.');
          const emailInput = layer.querySelector('input[name="email"]');
          if (emailInput) { emailInput.value = email; emailInput.focus(); }
        } else {
          if (authForm.dataset.authForm === 'login' && error.status === 403) showVerificationHelp(authForm, error.message);
          else if (authForm.dataset.authForm === 'login' && error.status === 401) showForgotHelp(authForm, 'Email or password is incorrect. If you’re signing in as the shop admin, use the new one-time password shared in the previous message. Customer accounts can use the reset link below.');
          else setError(authForm, error.message);
          submit.disabled = false;
        }
      }
      return;
    }
    const resetRequest = event.target.closest('[data-reset-request]');
    if (resetRequest) {
      event.preventDefault(); const submit = resetRequest.querySelector('[type="submit"]'); submit.disabled = true;
      try { const result = await api('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email: new FormData(resetRequest).get('email') }) }); const target = resetRequest.querySelector('.account-error'); target.hidden = false; target.textContent = result.message; }
      catch (error) { setError(resetRequest, error.message); submit.disabled = false; }
      return;
    }
    const resetComplete = event.target.closest('[data-reset-complete]');
    if (resetComplete) {
      event.preventDefault(); const submit = resetComplete.querySelector('[type="submit"]'); submit.disabled = true;
      try { const result = await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(resetComplete))) }); authView('login', result.message); }
      catch (error) { setError(resetComplete, error.message); submit.disabled = false; }
      return;
    }
    const productForm = event.target.closest('[data-admin-product-form]');
    if (productForm) {
      event.preventDefault(); const submit = productForm.querySelector('[type="submit"]'); submit.disabled = true;
      try {
        syncVariants(productForm);
        const fields = Object.fromEntries(new FormData(productForm)); const productId = productForm.dataset.productId;
        if (!editorMedia.length) throw new Error('Add at least one product image or video before publishing.');
        const features = fields.featuresText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        if (features.some(value => value.length > 120)) throw new Error('Keep each product feature to 120 characters or fewer.');
        const variants = editorVariants.map(variant => ({ id: variant.id || crypto.randomUUID(), name: String(variant.name || '').trim(), option: String(variant.name || '').trim(), price: variant.price === '' ? null : Number(variant.price), stock: variant.stock === '' ? null : Number(variant.stock), mediaIndex: variant.mediaIndex === '' ? -1 : Number(variant.mediaIndex) }));
        if (variants.some(variant => !variant.name)) throw new Error('Each variant needs a name.');
        if (variants.some(variant => (variant.price !== null && (!Number.isFinite(variant.price) || variant.price < 1)) || (variant.stock !== null && (!Number.isInteger(variant.stock) || variant.stock < 0)))) throw new Error('Check the variant price and stock overrides.');
        const primaryImage = editorMedia.find(item => item.type === 'image');
        if (!primaryImage) throw new Error('Add at least one product image. Video clips can be added alongside images.');
        const payload = { ...fields, features, media: editorMedia, variants, image: primaryImage.src, details: fields.details || fields.description };
        delete payload.featuresText;
        await api(productId ? `/api/admin/products/${encodeURIComponent(productId)}` : '/api/admin/products', { method: productId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        adminDataCache = null;
        await adminDashboard(activeDashboardUser, 'products', null, productId ? 'Product updated and saved to the storefront.' : 'Product added and saved to the storefront.');
      }
      catch (error) { const target = layer.querySelector('.account-error'); target.hidden = false; target.textContent = error.message; submit.disabled = false; }
    }
  });
  layer.addEventListener('click', event => {
    if (event.target.closest('[data-account-close]')) close();
  });
  document.addEventListener('rollcall:account', event => openAccount(event.detail?.mode));
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#reset-password')) resetPasswordView();
    else if (location.hash.startsWith('#account')) openAccount();
  });
  if (location.hash.startsWith('#reset-password')) resetPasswordView();
  if (location.hash.startsWith('#account')) openAccount();
})();
