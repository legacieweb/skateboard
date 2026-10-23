(() => {
  const RATE = 130;
  const apiBase = (document.querySelector('meta[name="rollcall-api-base"]')?.content || '').replace(/\/$/, '');
  const apiUrl = path => `${apiBase}${path}`;
  try { window.rollcallSessionToken ||= sessionStorage.getItem('rollcall-session-token') || ''; } catch {}
  const layer = document.querySelector('#commerceLayer');
  const grid = document.querySelector('.shop-grid');
  if (!layer || !grid) return;
  let products = [];
  let bag = JSON.parse(localStorage.getItem('rollcall-bag') || '[]');
  let selectedProduct = null;
  let selectedVariantId = '';
  let selectedMediaIndex = 0;
  const usd = value => `$${Number(value || 0).toFixed(2)}`;
  const kes = value => `KSh ${(Number(value || 0) * RATE).toLocaleString('en-KE', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const imageOf = p => p.image || p.media?.find(m => m.type === 'image')?.src || '';
  const variantImage = (product, variant) => variant?.mediaIndex != null && variant.mediaIndex >= 0 && product.media?.[variant.mediaIndex]?.type === 'image' ? product.media[variant.mediaIndex].src : imageOf(product);
  const persist = () => { localStorage.setItem('rollcall-bag', JSON.stringify(bag)); updateBagCount(); };
  const updateBagCount = () => document.querySelectorAll('[data-bag-count], .bag-count').forEach(el => el.textContent = bag.reduce((n, item) => n + item.quantity, 0));
  async function api(path, options = {}) { const headers = {'Content-Type':'application/json', ...(options.headers || {})}; if (window.rollcallSessionToken) headers.Authorization = `Bearer ${window.rollcallSessionToken}`; const response = await fetch(apiUrl(path), { credentials: apiBase ? 'include' : 'same-origin', ...options, headers }); const data = await response.json().catch(() => ({})); if (data.sessionToken) { window.rollcallSessionToken = data.sessionToken; try { sessionStorage.setItem('rollcall-session-token', data.sessionToken); } catch {} } if (!response.ok) throw new Error(data.error || data.message || 'Something went wrong.'); return data; }
  function renderProducts() {
    if (!products.length) { grid.innerHTML = '<p class="shop-loading">The catalog is being refreshed. Check back soon.</p>'; return; }
    grid.innerHTML = products.map(p => `<article class="shop-card"><button class="shop-product-open" type="button" data-product="${esc(p.id)}" aria-label="View ${esc(p.name)}"><div class="shop-card-image"><img src="${esc(imageOf(p))}" alt="${esc(p.name)}" loading="lazy"><span>${esc(p.badge || 'NEW ARRIVAL')}</span></div><div class="shop-card-copy"><p>${esc(p.category || 'SKATEBOARD')}</p><h3>${esc(p.name)}</h3><div class="shop-price">${kes(p.price)} <small>KES</small><span class="kes-equivalent">${usd(p.price)} USD</span></div></div></button><button class="button shop-add" type="button" data-add="${esc(p.id)}">ADD TO BAG <span>＋</span></button></article>`).join('');
  }
  const subtotalUsd = () => bag.reduce((sum, item) => { const p = products.find(product => product.id === item.id); const v = p?.variants?.find(variant => variant.id === item.variantId); return sum + Number(v?.price ?? p?.price ?? 0) * item.quantity; }, 0);
  const shippingUsd = () => subtotalUsd() >= 100 ? 0 : 8;
  function show(markup) { layer.innerHTML = `<div class="commerce-backdrop" data-close></div>${markup}`; layer.classList.add('is-open'); layer.setAttribute('aria-hidden','false'); }
  function close() { layer.classList.remove('is-open'); layer.setAttribute('aria-hidden','true'); setTimeout(() => { if (!layer.classList.contains('is-open')) layer.innerHTML = ''; }, 180); }
  function bagView() {
    const lines = bag.map((item, index) => { const p = products.find(product => product.id === item.id); if (!p) return ''; const v = p.variants?.find(variant => variant.id === item.variantId); const price = Number(v?.price ?? p.price); return `<article class="bag-line"><img src="${esc(variantImage(p,v))}" alt="${esc(v?.name || p.name)}"><div><b>${esc(p.name)}</b><small class="bag-variant">${esc(v?.name || 'Standard setup')}${p.shippingTime ? ` · Est. ${esc(p.shippingTime)}` : ''}</small><div class="bag-quantity"><button type="button" aria-label="Decrease ${esc(p.name)} quantity" data-qty="${index}" data-step="-1">−</button><span aria-label="Quantity">${item.quantity}</span><button type="button" aria-label="Increase ${esc(p.name)} quantity" data-qty="${index}" data-step="1">＋</button><button type="button" class="cart-remove" aria-label="Remove ${esc(p.name)} from cart" data-remove="${index}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div><strong>${kes(price * item.quantity)}<small class="kes-equivalent">${usd(price * item.quantity)} USD</small></strong></article>`; }).join('');
    const subtotal = subtotalUsd();
    show(`<aside class="bag-drawer cart-drawer"><header class="cart-header"><div><p class="shop-overline">ROLL CALL <span>/</span> YOUR BAG</p><h2>Your cart<span>.</span></h2><p>${bag.reduce((n,item)=>n+item.quantity,0)} ${bag.reduce((n,item)=>n+item.quantity,0) === 1 ? 'item' : 'items'} ready for the next session</p></div><button class="commerce-close" data-close aria-label="Close cart">×</button></header><div class="cart-items">${lines || '<div class="cart-empty"><span>＋</span><h3>Your bag is empty.</h3><p>Find a board that feels like yours.</p><button type="button" data-close>KEEP BROWSING <b>↗</b></button></div>'}</div><footer class="cart-footer"><div class="cart-totals"><div><span>Subtotal</span><b>${kes(subtotal)} <small>${usd(subtotal)} USD</small></b></div><div><span>Shipping</span><b>${shippingUsd() ? kes(shippingUsd()) : 'FREE'}${shippingUsd() ? `<small>${usd(shippingUsd())} USD</small>` : ''}</b></div><div class="cart-total"><span>Total <small>before checkout</small></span><b>${kes(subtotal + shippingUsd())}<small>${usd(subtotal + shippingUsd())} USD</small></b></div></div><p class="cart-currency-note">KES prices · Pay in KES or USD · $1 = KSh 130</p><button class="button checkout-start" data-checkout ${bag.length ? '' : 'disabled'}>CONTINUE TO CHECKOUT <span>↗</span></button></footer></aside>`);
  }
  function productView(product) {
    selectedProduct = product;
    selectedVariantId = '';
    selectedMediaIndex = 0;
    renderProductDetail();
  }
  function renderProductDetail() {
    const product = selectedProduct;
    if (!product) return;
    const media = (product.media?.length ? product.media : [{ type:'image', src:imageOf(product), name:product.name }]).filter(item => item?.src);
    const variants = Array.isArray(product.variants) ? product.variants.filter(item => item && item.id) : [];
    const variant = variants.find(item => item.id === selectedVariantId);
    if (variant?.mediaIndex != null && variant.mediaIndex >= 0 && selectedMediaIndex === 0) selectedMediaIndex = variant.mediaIndex;
    selectedMediaIndex = Math.min(Math.max(0, selectedMediaIndex), Math.max(0, media.length - 1));
    const activeMedia = media[selectedMediaIndex] || media[0];
    const price = Number(variant?.price ?? product.price);
    const stock = Number(variant?.stock ?? product.stock);
    const productFeatures = Array.isArray(product.features) ? product.features : [];
    const features = productFeatures.map((feature, index) => {
      const parts = String(feature).split(/\s+[–—]\s+|\s+-\s+/, 2);
      const title = parts.length > 1 ? parts[0] : `FEATURE ${String(index + 1).padStart(2, '0')}`;
      const description = parts.length > 1 ? parts[1] : parts[0];
      return `<li><span class="detail-feature-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${esc(title)}</strong><p>${esc(description)}</p></div></li>`;
    }).join('');
    const detailStory = String(product.details || '').trim();
    const storyMarkup = detailStory && detailStory !== String(product.description || '').trim() ? `<details class="detail-story"><summary>READ THE FULL PRODUCT STORY <span>＋</span></summary><p>${esc(detailStory)}</p></details>` : '';
    const gallery = media.map((item, index) => `<button type="button" class="detail-thumbnail ${index === selectedMediaIndex ? 'is-active' : ''}" data-detail-media="${index}" aria-label="Show product media ${index + 1}">${item.type === 'video' ? `<video src="${esc(item.src)}" muted preload="metadata"></video><span>▶</span>` : `<img src="${esc(item.src)}" alt="">`}</button>`).join('');
    const variantsMarkup = variants.length ? `<fieldset class="detail-variants"><legend><span>01</span> SELECT YOUR SETUP</legend><div class="detail-variant-options">${variants.map(item => `<button type="button" class="detail-variant ${item.id === selectedVariantId ? 'is-selected' : ''}" data-detail-variant="${esc(item.id)}" ${Number(item.stock ?? product.stock) < 1 ? 'disabled' : ''}><span class="variant-radio" aria-hidden="true"></span><strong>${esc(item.name)}</strong><span class="variant-price">${item.price ? kes(item.price) : 'Standard price'}${Number(item.stock ?? product.stock) < 1 ? ' · SOLD OUT' : ''}</span></button>`).join('')}</div></fieldset>` : '<p class="detail-single-setup"><span>01</span> SINGLE SETUP <i>·</i> Standard option</p>';
    show(`<section class="bag-drawer product-detail-drawer product-gallery-detail product-showcase" role="dialog" aria-modal="true" aria-label="${esc(product.name)} product details"><header class="detail-modal-topline"><span><i></i> ROLL CALL <b>/</b> OBJECT ${String(products.indexOf(product) + 1).padStart(2,'0')}</span><button class="commerce-close" data-close aria-label="Close product details">×</button></header><div class="product-detail-layout"><div class="detail-visual-column"><div class="detail-gallery"><div class="detail-photo" data-detail-stage>${activeMedia.type === 'video' ? `<video src="${esc(activeMedia.src)}" controls playsinline></video>` : `<img src="${esc(activeMedia.src)}" alt="${esc(product.name)} · image ${selectedMediaIndex + 1}">`}<span class="detail-photo-tag">${esc(product.badge || 'ROLL CALL SELECT')}</span>${media.length > 1 ? `<button class="gallery-arrow gallery-prev" type="button" data-gallery-step="-1" aria-label="Previous image">←</button><button class="gallery-arrow gallery-next" type="button" data-gallery-step="1" aria-label="Next image">→</button><small class="gallery-count">${String(selectedMediaIndex + 1).padStart(2,'0')} <i>/</i> ${String(media.length).padStart(2,'0')}</small>` : ''}</div>${media.length > 1 ? `<div class="detail-thumbnails">${gallery}</div>` : ''}<div class="detail-gallery-caption"><span>BUILT TO ROLL. MADE TO LAST.</span><span>${esc(product.category || 'SKATE / STREET')}</span></div></div></div><div class="detail-copy"><p class="detail-rating shop-overline">${esc(product.category || 'THE ROLL CALL SHOP')} <span>·</span> ${esc(product.rating || 'READY TO RIDE')}</p><h2>${esc(product.name)}</h2><p class="detail-intro">${esc(product.description || 'A considered setup for long sessions and new lines.')}</p>${storyMarkup}<div class="detail-price-block"><div><span>YOUR PRICE</span><strong>${kes(price)} <small>KES</small></strong></div><span class="detail-price-kes">${usd(price)} USD</span></div>${variantsMarkup}${features ? `<section class="detail-specs"><div class="detail-specs-heading"><div><span class="detail-specs-kicker">BUILT FOR THE SESSION</span><h3>The good details</h3></div><span class="detail-feature-total">${String(productFeatures.length).padStart(2,'0')} FEATURES</span></div><ul class="detail-perks">${features}</ul></section>` : ''}<section class="detail-buy-panel"><div class="detail-stock-row"><span class="detail-stock-dot ${stock < 1 ? 'is-out' : ''}"></span><span>${stock > 0 ? `READY TO SHIP <b>${stock} IN STOCK</b>` : 'CURRENTLY UNAVAILABLE'}</span></div><button class="button detail-add-button" data-add-detail="${esc(product.id)}" ${stock < 1 ? 'disabled' : ''}>ADD TO BAG <span>↗</span></button><div class="detail-assurance"><span>↗&nbsp; KES PRICES · USD ALSO AVAILABLE</span><span>✳&nbsp; ${product.shippingTime ? `EST. ${esc(product.shippingTime)}` : 'SHIPPING AT CHECKOUT'}</span></div></section></div></div></section>`);
  }
  function countryControl(savedCountry = '') {
    const restricted = bag.map(i => products.find(p => p.id === i.id)).filter(p => p?.shippingCountries?.length);
    if (!restricted.length) return `<label>COUNTRY<input name="country" autocomplete="country-name" value="${esc(savedCountry)}" required></label>`;
    const permits = name => restricted.every(p => p.shippingCountries.some(c => c.toLocaleLowerCase() === name.toLocaleLowerCase()));
    const choices = [...new Set(restricted.flatMap(p => p.shippingCountries))].filter(permits);
    if (!choices.length) return '<p class="account-error">These products do not share a shipping destination. Remove an item to continue.</p>';
    return `<label>SHIPPING COUNTRY<select name="country" autocomplete="country-name" required><option value="">Choose country</option>${choices.map(c => `<option value="${esc(c)}" ${c.toLocaleLowerCase() === String(savedCountry).toLocaleLowerCase() ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`;
  }
  async function checkoutView() {
    let user = null;
    try { user = (await api('/api/auth/me')).user; } catch {}
    const profile = user?.profile || {};
    const total = subtotalUsd() + shippingUsd();
    const initialCurrency = 'KES';
    const lines = bag.map(item => { const product = products.find(p => p.id === item.id); if (!product) return ''; const variant = product.variants?.find(v => v.id === item.variantId); const price = Number(variant?.price ?? product.price); return `<div class="checkout-item"><img src="${esc(variantImage(product,variant))}" alt="${esc(variant?.name || product.name)}"><div><strong>${esc(product.name)}</strong><small>${esc(variant?.name || 'Standard setup')} · Qty ${item.quantity}${product.shippingTime ? ` · Est. ${esc(product.shippingTime)}` : ''}</small></div><b>${kes(price * item.quantity)}</b></div>`; }).join('');
    show(`<aside class="bag-drawer checkout-drawer"><header class="checkout-page-header"><div><p class="shop-overline">ROLL CALL <span>/</span> CHECKOUT</p><h2>Almost yours.</h2><p>Delivery details and payment, in one easy step.</p></div><div class="checkout-steps" aria-label="Checkout progress"><span class="is-complete"><i>1</i> BAG</span><b></b><span class="is-current"><i>2</i> DELIVERY</span><b></b><span><i>3</i> PAYMENT</span></div></header><button class="commerce-close" data-close aria-label="Close checkout">×</button><div class="checkout-layout"><form class="shipping-form checkout-form" data-checkout-form><div class="checkout-form-heading"><div><span class="checkout-section-kicker">01 / YOUR DETAILS</span><h3>Where should we send it?</h3></div>${user ? '<span class="checkout-saved-label">SAVED TO YOUR ACCOUNT</span>' : '<button type="button" data-signin>Already a customer? Sign in</button>'}</div><div class="checkout-field-grid"><label class="checkout-field-wide">EMAIL FOR YOUR RECEIPT<input type="email" name="email" autocomplete="email" value="${esc(user?.email || '')}" placeholder="you@example.com" required></label><label>FULL NAME<input name="name" autocomplete="name" value="${esc(user?.name || '')}" placeholder="Your name" required></label><label>PHONE NUMBER<input name="phone" type="tel" autocomplete="tel" value="${esc(profile.phone || '')}" placeholder="+254…" required></label><label class="checkout-field-wide">STREET ADDRESS<input name="address" autocomplete="street-address" value="${esc(profile.address || '')}" placeholder="House, street, and area" required></label><label>CITY<input name="city" autocomplete="address-level2" value="${esc(profile.city || '')}" required></label><label>COUNTY / REGION<input name="region" autocomplete="address-level1" value="${esc(profile.region || '')}" required></label><label>POSTAL CODE<input name="postalCode" autocomplete="postal-code" value="${esc(profile.postalCode || '')}" required></label>${countryControl(profile.country || '')}</div><section class="checkout-currency-panel"><div class="currency-panel-title"><span>02 / PAYMENT CURRENCY</span><small data-checkout-rate>KES is the primary currency · $1 = KSh 130</small></div><select name="currency" data-payment-currency aria-label="Payment currency"><option value="KES" selected>KES · Kenyan shillings</option><option value="USD">USD · US dollars</option></select><div class="checkout-amount"><span>AMOUNT TO PAY</span><strong data-checkout-total>${kes(total)} KES</strong></div></section><p class="account-error" role="alert" hidden></p><button class="button checkout-pay-button" type="submit">CONTINUE TO SECURE PAYMENT <span>↗</span></button><p class="checkout-trust"><span aria-hidden="true">🔒</span> Secure payment with Paystack. Your receipt comes from Roll Call.</p></form><section class="checkout-summary"><div class="checkout-summary-heading"><span>YOUR ORDER</span><b>${bag.reduce((n,item)=>n+item.quantity,0)} ITEMS</b></div>${lines}<div class="checkout-totals"><p><span>Subtotal</span><b>${kes(subtotalUsd())}</b></p><p><span>Shipping</span><b>${shippingUsd() ? (initialCurrency === 'KES' ? kes(shippingUsd()) : usd(shippingUsd())) : 'On us'}</b></p><p class="checkout-total-row"><span>Order total</span><b>${kes(total)} KES</b></p><small>${usd(total)} USD reference · $1 = KSh 130</small></div><button type="button" class="checkout-back" data-checkout-back>← Return to bag</button></section></div></aside>`);
  }
  async function startCheckout(form) {
    const submit = form.querySelector('[type=submit]'); const error = form.querySelector('.account-error'); submit.disabled = true; error.hidden = true;
    try {
      const values = Object.fromEntries(new FormData(form)); const currency = values.currency; delete values.currency; const email = values.email; delete values.email;
      const payment = await api('/api/checkout/initialize', { method:'POST', body:JSON.stringify({ items:bag, email, shipping:values, currency }) });
      if (typeof window.PaystackPop === 'undefined') throw new Error('Paystack checkout is unavailable. Reload and try again.');
      const popup = new window.PaystackPop();
      popup.newTransaction({ key:payment.publicKey, email:payment.email, amount:payment.amount, currency:payment.currency, reference:payment.reference, metadata:payment.metadata, onSuccess: async result => {
        try { const confirmation = await api('/api/payments/verify', { method:'POST', body:JSON.stringify({ reference:result.reference }) }); bag=[]; persist(); close(); show(`<section class="bag-drawer order-success"><p class="shop-overline">ROLL CALL / ORDER CONFIRMED</p><div class="success-mark">✓</div><h2>You’re all set.</h2><p>Order <strong>${esc(confirmation.order.orderNumber)}</strong> is paid. Your receipt and delivery details are on their way by email.</p><h3>${currency === 'KES' ? `KSh ${Number(payment.amount/100).toLocaleString('en-KE')}` : `${usd(payment.amount/100)} USD`}</h3><button class="button" data-close>BACK TO THE SHOP</button></section>`); }
        catch (e) { error.hidden=false; error.textContent=e.message; }
      }, onCancel: () => { submit.disabled=false; } });
    } catch (e) { error.hidden=false; error.textContent=e.message; submit.disabled=false; }
  }
  grid.addEventListener('click', event => { const opener=event.target.closest('[data-product]'); if(opener){const p=products.find(x=>x.id===opener.dataset.product);if(p)productView(p);return;} const add=event.target.closest('[data-add]'); if(add){const p=products.find(x=>x.id===add.dataset.add);if(p){if(p.variants?.length){productView(p);return;}bag.push({id:p.id,quantity:1});persist();bagView();}} });
  layer.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) { close(); return; }
    if (event.target.closest('[data-checkout-back]')) { bagView(); return; }
    const variantChoice = event.target.closest('[data-detail-variant]'); if (variantChoice && selectedProduct) { selectedVariantId = variantChoice.dataset.detailVariant; const variant = selectedProduct.variants?.find(item => item.id === selectedVariantId); selectedMediaIndex = variant?.mediaIndex >= 0 ? variant.mediaIndex : 0; renderProductDetail(); return; }
    const mediaChoice = event.target.closest('[data-detail-media]'); if (mediaChoice) { selectedMediaIndex = Number(mediaChoice.dataset.detailMedia); renderProductDetail(); return; }
    const galleryStep = event.target.closest('[data-gallery-step]'); if (galleryStep && selectedProduct) { const count = selectedProduct.media?.length || 1; selectedMediaIndex = (selectedMediaIndex + Number(galleryStep.dataset.galleryStep) + count) % count; renderProductDetail(); return; }
    const add=event.target.closest('[data-add-detail]'); if(add){const p=products.find(x=>x.id===add.dataset.addDetail);const variant=selectedVariantId;if(p?.variants?.length&&!variant){layer.querySelector('[data-detail-variant]')?.focus();return;}const chosen=p?.variants?.find(item=>item.id===variant);if(Number(chosen?.stock ?? p?.stock) < 1)return;const found=bag.find(i=>i.id===p.id&&i.variantId===variant);if(found)found.quantity++;else bag.push({id:p.id,quantity:1,...(variant?{variantId:variant}:{})});persist();close();return;}
    const qty=event.target.closest('[data-qty]'); if(qty){const i=Number(qty.dataset.qty);bag[i].quantity+=Number(qty.dataset.step);if(bag[i].quantity<1)bag.splice(i,1);persist();bagView();return;}
    const remove=event.target.closest('[data-remove]');if(remove){bag.splice(Number(remove.dataset.remove),1);persist();bagView();return;}
    if(event.target.closest('[data-checkout]'))checkoutView();
  });
  layer.addEventListener('change', event => {
    const country = event.target.matches('[name="country"]') ? String(event.target.value).toLowerCase() : null;
    const currency = layer.querySelector('[data-payment-currency]');
    if (country === 'kenya') currency.value = 'KES';
    if (event.target.matches('[data-payment-currency]') || country !== null) {
      const total = subtotalUsd() + shippingUsd();
      layer.querySelector('[data-checkout-total]').textContent = currency.value === 'KES' ? `${kes(total)} KES` : `${usd(total)} USD`;
      layer.querySelector('[data-checkout-rate]').textContent = currency.value === 'KES' ? 'Kenyan delivery · converted at $1 = KSh 130' : 'International delivery · $1 = KSh 130';
      layer.querySelectorAll('.checkout-item>b').forEach((node, index) => { const item = bag[index]; const p = products.find(product => product.id === item?.id); const v = p?.variants?.find(variant => variant.id === item?.variantId); const amount = Number(v?.price ?? p?.price ?? 0) * (item?.quantity || 0); node.textContent = currency.value === 'KES' ? kes(amount) : usd(amount); });
      const summary = layer.querySelector('.checkout-totals');
      if (summary) summary.innerHTML = `<p><span>Subtotal</span><b>${currency.value === 'KES' ? kes(subtotalUsd()) : usd(subtotalUsd())}</b></p><p><span>Shipping</span><b>${shippingUsd() ? (currency.value === 'KES' ? kes(shippingUsd()) : usd(shippingUsd())) : 'On us'}</b></p><p class="checkout-total-row"><span>Order total</span><b>${currency.value === 'KES' ? `${kes(total)} KES` : `${usd(total)} USD`}</b></p><small>${currency.value === 'KES' ? 'Kenyan shillings' : `≈ ${kes(total)} · $1 = KSh 130`}</small>`;
    }
  });
  layer.addEventListener('submit', event => {if(event.target.matches('[data-checkout-form]')){event.preventDefault();startCheckout(event.target);}});
  document.addEventListener('click', event => { if(event.target.closest('[data-open-bag], .bag-button, .cart-button, #bagButton')) bagView(); });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  document.addEventListener('rollcall:authenticated', () => {});
  window.addEventListener('hashchange', () => { if(location.hash.startsWith('#product-')){const p=products.find(item=>item.id===location.hash.slice(9));if(p)productView(p);} });
  updateBagCount();
  api('/api/products').then(result=>{products=result.products||[];renderProducts();if(location.hash.startsWith('#product-')){const p=products.find(item=>item.id===location.hash.slice(9));if(p)productView(p);}}).catch(()=>{grid.innerHTML='<p class="shop-loading">The shop could not connect. Refresh to try again.</p>';});
})();
