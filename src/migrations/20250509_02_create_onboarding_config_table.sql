-- Create onboarding_config table for onboarding message and admin users per location
CREATE TABLE IF NOT EXISTS onboarding_config (
    location TEXT PRIMARY KEY,
    admin_user_slack_ids TEXT [] NOT NULL,
    onboarding_message_content TEXT NOT NULL
);
INSERT INTO onboarding_config (
        location,
        admin_user_slack_ids,
        onboarding_message_content
    )
VALUES (
        'Seattle',
        -- Lowell, Laura Knaub
        ARRAY ['U073CUASRSR', 'U07QU1QCX52'],
        'Here are some tips:

1️⃣ Join #introductions (introduce yourself here!)
2️⃣ Also join #sea-announcements, #sea-water-cooler, and #sea-whos-in (to see who''s in the space today)
3️⃣ Make a request in #ask.
        
Outside of slack:

  •  Bookmark the <https://members.9zero.com/login|members portal> and <https://www.notion.so/9zero/13077f10821680f38eafcce7d3f72e17|members directory> on your browser
  •  Bring your lunch on Wednesdays 12-1 for Members Lunch and on Thursdays for the Lunch and Learn
  •  check out other events on the <https://www.linkedin.com/feed/update/urn:li:activity:7259263131774824450/|calendar>.

As always let us know if there''s anything we can do to support you!'
    ),
    (
        'San Francisco',
        -- Daphne, Kirkland
        ARRAY ['U08AG6NF90T', 'U07394PGKRC'],
        'Here are some tips:

1️⃣ Join #introductions (introduce yourself here!)
2️⃣ Make a request in #ask
3️⃣ Also join #sf-events, #sf-general (for everything else), #sf-whos-in (to see who''s in the space today), #sf-coffee-chats to be randomly matched for a coffee each week... etc etc. There are so many!
        
Outside of slack:

  •  Bookmark the <https://members.9zero.com/login|members portal> and <https://www.notion.so/9zero/13077f10821680f38eafcce7d3f72e17|members directory> on your browser
  •  Stop by the front desk to grab your 9Zero t-shirt and get your member polaroid taken! 📸
  •  Bring your lunch on Wednesdays 12-1 for Members Lunch, and check out other events on the <https://9zero.com/sf-subscribe-to-the-events-calendar|calendar>.

As always let us know if there''s anything we can do to support you!'
    ) ON CONFLICT (location) DO NOTHING;