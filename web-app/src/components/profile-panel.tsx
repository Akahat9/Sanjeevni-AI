"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ConfirmationResult, GoogleAuthProvider, RecaptchaVerifier, User,
  deleteUser, signInWithPhoneNumber, signInWithPopup, signOut, updateProfile,
} from "firebase/auth";
import { get, ref as databaseRef, remove, set } from "firebase/database";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Camera, Check, ChevronRight, HeartPulse, Languages, LoaderCircle, LogIn,
  LogOut, Phone, Save, Settings, ShieldCheck, UserRound, X,
} from "lucide-react";
import { getFirebaseAuth, getFirebaseStorage, getRealtimeDatabase } from "@/lib/firebase";

export type MedicalProfile = {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  emergencyName: string;
  emergencyPhone: string;
  allergies: string;
  conditions: string;
  medications: string;
  organDonor: boolean;
  abhaAddress: string;
  healthDataConsent: boolean;
};

const emptyProfile: MedicalProfile = {
  fullName: "", dateOfBirth: "", gender: "", bloodGroup: "", emergencyName: "",
  emergencyPhone: "", allergies: "", conditions: "", medications: "",
  organDonor: false, abhaAddress: "", healthDataConsent: false,
};

export function ProfilePanel({
  open, user, onClose, onNavigate, language, setLanguage,
}: {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onNavigate: (page: "Settings" | "About") => void;
  language: "en" | "hi";
  setLanguage: (language: "en" | "hi") => void;
}) {
  const [profile, setProfile] = useState<MedicalProfile>(emptyProfile);
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const recaptcha = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!user) return;
    const database = getRealtimeDatabase();
    if (!database) return;
    get(databaseRef(database, `users/${user.uid}/profile`)).then((snapshot) => {
      if (snapshot.exists()) setProfile({ ...emptyProfile, ...snapshot.val() });
      else setProfile((current) => ({ ...current, fullName: user.displayName || "" }));
    }).catch(() => setMessage("Could not load your private medical profile."));
  }, [user]);

  if (!open) return null;

  async function googleSignIn() {
    const auth = getFirebaseAuth();
    if (!auth) return setMessage("Firebase Authentication is not configured.");
    setWorking(true);
    setMessage("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign-in failed.");
    } finally {
      setWorking(false);
    }
  }

  async function sendOtp() {
    const auth = getFirebaseAuth();
    if (!auth) return setMessage("Firebase Authentication is not configured.");
    if (!/^\+91[6-9]\d{9}$/.test(phone.replace(/\s/g, ""))) return setMessage("Enter a valid Indian mobile number with +91.");
    setWorking(true);
    setMessage("");
    try {
      recaptcha.current?.clear();
      recaptcha.current = new RecaptchaVerifier(auth, "profile-recaptcha", { size: "invisible" });
      setConfirmation(await signInWithPhoneNumber(auth, phone.replace(/\s/g, ""), recaptcha.current));
      setMessage("OTP sent to your mobile number.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send OTP.");
    } finally {
      setWorking(false);
    }
  }

  async function verifyOtp() {
    if (!confirmation || otp.length < 6) return;
    setWorking(true);
    try {
      await confirmation.confirm(otp);
      setMessage("Phone number verified.");
      setConfirmation(null);
      setOtp("");
    } catch {
      setMessage("Invalid or expired OTP.");
    } finally {
      setWorking(false);
    }
  }

  async function saveProfile() {
    if (!user) return;
    if (!profile.healthDataConsent) return setMessage("Please give explicit consent before saving health data.");
    const database = getRealtimeDatabase();
    if (!database) return;
    setWorking(true);
    try {
      await set(databaseRef(database, `users/${user.uid}/profile`), {
        ...profile,
        email: user.email || "",
        phone: user.phoneNumber || "",
        photoURL: user.photoURL || "",
        consentAt: new Date().toISOString(),
        consentVersion: "DPDP-2025-v1",
        updatedAt: new Date().toISOString(),
      });
      if (profile.fullName && profile.fullName !== user.displayName) await updateProfile(user, { displayName: profile.fullName });
      setMessage("Private medical profile saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteAccountAndData() {
    if (!user || !window.confirm("Delete your private medical profile, photo, reports and account? This cannot be undone.")) return;
    setWorking(true);
    try {
      const database = getRealtimeDatabase();
      const storage = getFirebaseStorage();
      if (database) await remove(databaseRef(database, `users/${user.uid}`));
      if (storage) await deleteObject(storageRef(storage, `profile-photos/${user.uid}/avatar`)).catch(() => undefined);
      await deleteUser(user);
      setMessage("Your consent was withdrawn and account data was deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Please sign in again and retry.` : "Could not delete account data.");
    } finally {
      setWorking(false);
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const storage = getFirebaseStorage();
    if (!file || !user || !storage) return;
    if (file.size > 5 * 1024 * 1024 || !file.type.startsWith("image/")) return setMessage("Choose an image below 5 MB.");
    setWorking(true);
    try {
      const target = storageRef(storage, `profile-photos/${user.uid}/avatar`);
      await uploadBytes(target, file, { contentType: file.type });
      const photoURL = await getDownloadURL(target);
      await updateProfile(user, { photoURL });
      setMessage("Profile photo updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Photo upload failed.");
    } finally {
      setWorking(false);
    }
  }

  function update(field: keyof MedicalProfile, value: string | boolean) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  return <div className="profile-overlay" role="dialog" aria-modal="true">
    <button className="profile-backdrop" onClick={onClose} aria-label="Close profile" />
    <section className="profile-panel">
      <header><div><span className="kicker"><ShieldCheck size={14} /> Private health identity</span><h2>{user ? "Your health profile" : "Sign in to Sanjeevni-AI"}</h2></div><button onClick={onClose}><X size={19} /></button></header>
      {!user ? <div className="profile-signin">
        <span className="signin-illustration"><UserRound size={38} /></span>
        <h3>Keep reports private and personal</h3>
        <p>Only your authenticated account can view your saved profile and reports.</p>
        <button className="google-button" disabled={working} onClick={googleSignIn}><LogIn size={18} /> Continue with Google</button>
        <div className="signin-divider"><span>or mobile number</span></div>
        <div className="phone-signin"><Phone size={17} /><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 9876543210" /><button disabled={working} onClick={sendOtp}>Send OTP</button></div>
        {confirmation && <div className="phone-signin"><Check size={17} /><input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit OTP" /><button disabled={working} onClick={verifyOtp}>Verify</button></div>}
        <div id="profile-recaptcha" />
      </div> : <div className="profile-content">
        <div className="profile-summary">
          <label className="profile-photo"><input type="file" accept="image/*" onChange={uploadPhoto} />{user.photoURL ? <span style={{ backgroundImage: `url(${user.photoURL})` }} /> : <span><UserRound size={30} /></span>}<i><Camera size={13} /></i></label>
          <div><strong>{profile.fullName || user.displayName || "Sanjeevni-AI member"}</strong><small>{user.email || user.phoneNumber}</small><em>Authenticated profile</em></div>
        </div>
        <div className="emergency-card">
          <div><span><HeartPulse size={20} /> Emergency Medical Card</span><small>Show only with the patient’s consent</small></div>
          <strong>{profile.fullName || "Complete your name"}</strong>
          <p><b>{profile.bloodGroup || "Blood group —"}</b><span>Allergies: {profile.allergies || "Not supplied"}</span><span>Emergency: {profile.emergencyPhone || "Not supplied"}</span></p>
        </div>
        <div className="medical-form">
          <label><span>Full name</span><input value={profile.fullName} onChange={(event) => update("fullName", event.target.value)} /></label>
          <label><span>Date of birth</span><input type="date" value={profile.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} /></label>
          <label><span>Gender</span><select value={profile.gender} onChange={(event) => update("gender", event.target.value)}><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></label>
          <label><span>Blood group</span><select value={profile.bloodGroup} onChange={(event) => update("bloodGroup", event.target.value)}><option value="">Select</option>{["A+","A-","B+","B-","AB+","AB-","O+","O-","Unknown"].map((group) => <option key={group}>{group}</option>)}</select></label>
          <label><span>Emergency contact name</span><input value={profile.emergencyName} onChange={(event) => update("emergencyName", event.target.value)} /></label>
          <label><span>Emergency mobile</span><input value={profile.emergencyPhone} onChange={(event) => update("emergencyPhone", event.target.value)} /></label>
          <label className="wide"><span>Known allergies</span><textarea value={profile.allergies} onChange={(event) => update("allergies", event.target.value)} /></label>
          <label className="wide"><span>Medical conditions</span><textarea value={profile.conditions} onChange={(event) => update("conditions", event.target.value)} /></label>
          <label className="wide"><span>Current medications</span><textarea value={profile.medications} onChange={(event) => update("medications", event.target.value)} /></label>
          <label className="wide"><span>ABHA address (optional)</span><input value={profile.abhaAddress} onChange={(event) => update("abhaAddress", event.target.value)} placeholder="name@abdm" /></label>
          <label className="organ-row wide"><input type="checkbox" checked={profile.organDonor} onChange={(event) => update("organDonor", event.target.checked)} /><span>Organ donor status (self-declared)</span></label>
          <label className="consent-box wide"><input type="checkbox" checked={profile.healthDataConsent} onChange={(event) => update("healthDataConsent", event.target.checked)} /><span>I explicitly consent to Sanjeevni-AI storing and processing my medical profile and private reports. I can withdraw consent and delete my data at any time.</span></label>
        </div>
        <button className="primary-btn save-profile" disabled={working} onClick={saveProfile}>{working ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Save private profile</button>
      </div>}
      {message && <p className="profile-message">{message}</p>}
      <footer>
        <button onClick={() => setLanguage(language === "en" ? "hi" : "en")}><Languages size={17} /><span>{language === "en" ? "हिंदी में बदलें" : "Switch to English"}</span><ChevronRight size={15} /></button>
        <button onClick={() => { onNavigate("Settings"); onClose(); }}><Settings size={17} /><span>Settings</span><ChevronRight size={15} /></button>
        <button onClick={() => { onNavigate("About"); onClose(); }}><ShieldCheck size={17} /><span>About & privacy</span><ChevronRight size={15} /></button>
        {user && <button className="logout" onClick={() => { const auth = getFirebaseAuth(); if (auth) signOut(auth); }}><LogOut size={17} /><span>Sign out</span></button>}
        {user && <button className="delete-account" disabled={working} onClick={deleteAccountAndData}><ShieldCheck size={17} /><span>Withdraw consent & delete data</span></button>}
      </footer>
    </section>
  </div>;
}
