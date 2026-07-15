# Integration Guide: Connecting External Lead Sources

To turn your "SimpleFunnel CRM" into a live lead-generation machine, you need to expose your local server to the internet so it can receive webhooks.

## 1. Exposing your Local Server

The easiest way to receive real leads from Meta, Zapier, or your website is using **Ngrok**.

### Step A: Install Ngrok
If you don't have it, install it via:
- **macOS**: `brew install ngrok/ngrok/ngrok`
- **Other OS**: [Download from ngrok.com](https://ngrok.com/download)

### Step B: Start the Tunnel
Run your CRM server (`node server.js`), then in a NEW terminal run:
```bash
ngrok http 3000
```
Ngrok will provide a **Forwarding URL** (e.g., `https://a1b2-c3d4.ngrok-free.app`).

## 2. Using the Generic Webhook

You can now send leads from any app (like a custom script or Zapier) to:
`https://YOUR-NGROK-URL/api/webhooks/generic`

### Test it with `curl`:
```bash
curl -X POST https://YOUR-NGROK-URL/api/webhooks/generic \
-H "Content-Type: application/json" \
-d '{
  "name": "Live Test Lead",
  "email": "live@example.com",
  "phone": "+123456789",
  "source": "External API"
}'
```

## 3. Website Form Integration

Copy the HTML snippet from the **Integrations** tab in your CRM and paste it into any website. 
**Note**: Replace `http://localhost:3000` with your **Ngrok URL** in the form's `action` attribute to make it work publicly!

## 4. Meta Lead Ads Setup

1. Go to the [Meta Developers Portal](https://developers.facebook.com/).
2. Create an App and add the **Webhooks** product.
3. Set the **Callback URL** to `https://YOUR-NGROK-URL/api/webhooks/meta`.
4. Use the "Lead Ads" object.
5. In the **Lead Ads Testing Tool**, send a test lead.
