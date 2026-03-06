import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import make_msgid
import imaplib
import email
import time
import json
import sys
import os

with open('backend/storage/smtp_config.json', 'r') as f:
    config = json.load(f)

user = config['smtp_user']
password = config['smtp_pass']
target_email = "yashviparikh02@gmail.com"
target_name = "Yashvi Parikh"

print(f"Starting Nurture Campaign Test for: {target_email}")
print("-" * 50)

def send_email(subject, body, reply_to_id=None):
    msg = MIMEMultipart()
    msg['From'] = user
    msg['To'] = target_email
    msg['Subject'] = subject
    
    # Generate a unique message ID to track threading
    msg_id = make_msgid()
    msg['Message-ID'] = msg_id
    
    if reply_to_id:
        msg['In-Reply-To'] = reply_to_id
        msg['References'] = reply_to_id
        
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        server = smtplib.SMTP(config['smtp_host'], config['smtp_port'])
        if config.get('use_tls', True):
            server.starttls()
        server.login(user, password)
        server.send_message(msg)
        server.quit()
        print(f"Sent email: '{subject}'")
        return msg_id
    except Exception as e:
        print(f"Failed to send email: {e}")
        return None

def wait_for_reply(timeout_seconds=90):
    print(f"Waiting up to {timeout_seconds}s for a reply from {target_email}...")
    
    try:
        mail = imaplib.IMAP4_SSL('imap.gmail.com')
        mail.login(user, password)
    except Exception as e:
        print(f"Failed to connect to IMAP: {e}")
        return False
        
    start_time = time.time()
    while time.time() - start_time < timeout_seconds:
        # Refresh the inbox state each check to see new emails
        mail.select('inbox')
        
        status, messages = mail.search(None, f'(FROM "{target_email}") UNSEEN')
        if status == 'OK' and messages and messages[0]:
            print("\nReceived a reply!")
            for num in messages[0].split():
                status, data = mail.fetch(num, '(RFC822)')
                msg = email.message_from_bytes(data[0][1])
                print(f"Reply Subject: {msg['Subject']}")
                return True
        sys.stdout.write(".")
        sys.stdout.flush()
        time.sleep(5)
    
    print("\nNo reply received within the timeout timeframe.")
    return False

# STEP 1: Soft Intro
intro_subject = f"Connecting: {target_name}"
intro_body = f"Hi {target_name},\n\nI was looking at your recent work and wanted to connect. Would love to hear about what you're focusing on lately.\n\nBest,"

intro_msg_id = send_email(intro_subject, intro_body)

# STEP 2: Wait for reply
has_replied = wait_for_reply(180)  # Wait 3 minutes for a reply for demo purposes

print("-" * 50)
# STEP 3: Conditional Branching (Pitch or Follow-up)
if has_replied:
    print("Branch: User Replied! PITCHING PRODUCT.")
    pitch_subject = f"Re: {intro_subject}"
    pitch_body = f"Hi {target_name},\n\nThanks for getting back to me!\n\nI reached out because we've built a workflow automation engine, OutreachFlow AI, that helps scale outbound efforts by 400% through hyper-personalized AI models.\n\nWould you be open to a brief 10-minute demo to see how we could add value to your current pipeline?\n\nCheers,\nOutreachFlow Team"
    send_email(pitch_subject, pitch_body, reply_to_id=intro_msg_id)
else:
    print("Branch: No Reply yet. SENDING NURTURE FOLLOW-UP.")
    followup_subject = f"Re: {intro_subject}"
    followup_body = f"Hi {target_name},\n\nJust floating this to the top of your inbox. Let me know if you'd be open to a quick chat when you have a moment.\n\nThanks,\nOutreachFlow Team"
    send_email(followup_subject, followup_body, reply_to_id=intro_msg_id)

print("-" * 50)
print("Test Nurture Sequence Completed.")
