# WhatsApp Web Pro - Android APK Build & On-Device Guide

এই প্রজেক্টটি এখন সম্পূর্ণভাবে **Capacitor Android** আর্কিটেকচারে কনভার্ট ও কনফিগার করা হয়েছে।

---

## 📱 আর্কিটেকচার ওভারভিউ (Architecture Overview)

1. **Frontend (UI):** React + Tailwind CSS + Lucide Icons যা Capacitor Native WebView-তে হাই-স্পিড নেটিভ অ্যাপের মতো চলে।
2. **On-Device Backend:** Baileys + Express + Socket.io ইঞ্জিনটি ফোনের ভেতরে লোকাল হোস্ট (`http://127.0.0.1:3000`) হিসেবে রান করে।
3. **লোকাল আইপি কানেকশন:** ফোনের নিজস্ব মোবাইল ডেটা (GP/Robi/Banglalink/Airtel) বা ওয়াইফাই ব্যবহার করার কারণে **WhatsApp-এর পেয়ারিং কোড রিকোয়েস্ট পাঠালে সাথে সাথে ফোনে অফিশিয়াল পুশ নোটিফিকেশন চলে আসে।**
4. **জিরো সার্ভার খরচ:** ব্যবহারকারীর ফোন নিজেই সার্ভার হিসেবে কাজ করে, তাই কোনো ক্লাউড সার্ভারের প্রয়োজন নেই।

---

## 🛠️ APK তৈরি করার সহজ ৩টি পদ্ধতি

> 💡 **Node.js রিকোয়ারমেন্ট:** Capacitor 8-এর জন্য আপনার পিসিতে **Node.js >= 22.0.0** ইনস্টল থাকতে হবে (`node -v` দিয়ে চেক করুন)। GitHub Actions-এ এটি স্বয়ংক্রিয়ভাবে Node 22 সেট করে দেওয়া হয়েছে।

### পদ্ধতি ১: Android Studio দিয়ে (সবচেয়ে সহজ)
1. টার্মিনালে রান করুন:
   ```bash
   npm run cap:build
   npm run cap:open
   ```
2. Android Studio স্বয়ংক্রিয়ভাবে ওপেন হবে।
3. মেনু থেকে **Build > Build Bundle(s) / APK(s) > Build APK(s)** চাপুন।
4. কিছুক্ষণের মধ্যেই `app-debug.apk` তৈরি হয়ে যাবে এবং সরাসরি ফোনে ইনস্টল করতে পারবেন!

---

### পদ্ধতি ২: টার্মিনাল / কমান্ড লাইন দিয়ে (CLI)
আপনার পিসিতে যদি Java JDK (17 বা 21) ইনস্টল করা থাকে:
```bash
# ১. ওয়েব বিল্ড ও ক্যাপাসিটর সিঙ্ক
npm run cap:build

# ২. অ্যান্ড্রয়েড ফোল্ডারে গিয়ে APK তৈরি
cd android
./gradlew assembleDebug
```
তৈরি হওয়া APK ফাইলটি পাবেন:
👉 `android/app/build/outputs/apk/debug/app-debug.apk`

---

### পদ্ধতি ৩: GitHub Actions দিয়ে ক্লাউডে অটো-বিল্ড (কম্পিউটার ছাড়াই)
প্রজেক্টের ভেতর ইতিমধ্যে `.github/workflows/build-apk.yml` তৈরি করে দেওয়া হয়েছে।
1. কোডটি আপনার GitHub রিপোজিটরিতে পুশ করুন।
2. GitHub-এর **Actions** ট্যাবে স্বয়ংক্রিয়ভাবে APK বিল্ড শুরু হবে।
3. বিল্ড শেষে **Artifacts** থেকে এক ক্লিকেই রেডি `WhatsApp-Web-Pro-Debug-APK` ডাউনলোড করে ফোনে ইনস্টল করে নিতে পারবেন!

---

## 🔐 অন্তর্ভুক্ত অ্যান্ড্রয়েড পারমিশনসমূহ:
- `INTERNET` & `ACCESS_NETWORK_STATE` (নেটওয়ার্ক ও সকেট)
- `RECORD_AUDIO` & `MODIFY_AUDIO_SETTINGS` (ভয়েস নোট রেকর্ড)
- `POST_NOTIFICATIONS` (নতুন মেসেজ ও পেয়ারিং পুশ নোটিফিকেশন)
- `FOREGROUND_SERVICE` & `WAKE_LOCK` (স্ক্রিন লক থাকলেও ব্যাকগ্রাউন্ডে চালু রাখা)
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (অ্যান্ড্রয়েড ব্যাটারি সেভারের হাত থেকে সচল রাখা)
- `usesCleartextTraffic="true"` (লোকাল `127.0.0.1:3000` ব্যাকএন্ডের সাথে নিরাপদ যোগাযোগ)
