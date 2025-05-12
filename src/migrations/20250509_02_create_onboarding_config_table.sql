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
        ARRAY ['U073CUASRSR', 'U07QU1QCX52'],
        -- Lowell, Laura Knaub
        'We' re excited to have you ! Here are some tips: -
        Join #introductions (introduce yourself here!)
        - Also
        join #sea-announcements, #sea-water-cooler, and #sea-whos-in (to see who's in the space today)
        - Make a request in #ask.
        Outside of slack: * Bookmark the members portal
        and members directory on your browser * Bring your lunch on Wednesdays 12 -1 for Members Lunch,
        on Thursday for the Lunch
        and Learn * check out other events on the [calendar](
            https: // www.linkedin.com / feed /
            update / urn :li :activity :7259263131774824450 /
        ).As always let us know if there 's anything we can do to support you!'
    ),
    (
        'San Francisco',
        ARRAY ['U08AG6NF90T', 'U07394PGKRC'],
        -- Daphne, Kirkland
        'We''re excited to have you! Here are some tips:
        
        - Join #introductions (introduce yourself here!)
        - Make a request in #ask
        - Also join #sf-events, #sf-general (for everything else), #sf-whos-in (to see who''s in the space today), #sf-coffee-chats to be randomly matched for a coffee each week... etc etc. There are so many!
        
        Outside of slack:
        * Bookmark the members portal and members directory on your browser
        * Stop by the front desk to grab your 9Zero t-shirt and get your member polaroid taken! 📸
        * Bring your lunch on Wednesdays 12-1 for Members Lunch, and check out other events on the [calendar](https://9zero.com/sf-subscribe-to-the-events-calendar).
        
        As always let us know if there''s anything we can do to support you!'
    ) ON CONFLICT (location) DO NOTHING;