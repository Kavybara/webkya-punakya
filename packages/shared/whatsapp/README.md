# WhatsApp Auto Order Templates

Edit kata-kata customer auto order dari satu tempat:

`packages/shared/whatsapp/templates.mjs`

Bagian yang paling sering diedit:

- `WHATSAPP_STRINGS.stockEmpty`: balasan saat `#stock/#stok` kosong.
- `WHATSAPP_STRINGS.buyNowFormat`: format salah untuk `#buynow`.
- `WHATSAPP_STRINGS.buyNowUnavailable`: kode produk tidak ditemukan.
- `WHATSAPP_STRINGS.buyNowInsufficient`: stok kurang.
- `buildStockMessage()`: tampilan katalog `#stock`.
- `buildOrderQrisMessage()`: tampilan invoice QRIS.
- `buildOrderMissingQrisMessage()`: fallback kalau QRIS gagal dibuat.

Placeholder utama yang tersedia di function template:

- `order.order_code`
- `payment.payment_code`
- `product.name`
- `variant.name`
- `variant.code`
- `variant.price`
- `variant.available_stock`
- `order.terms_snapshot`
- `order.warranty_until`

Command grup `.menu`, `.list`, sewa grup, dan template list grup tidak dipakai di migrasi auto order ini.
