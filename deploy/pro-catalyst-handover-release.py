"""Apply or roll back the guarded app-only Pro Catalyst chatbot overlays."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
ACTIVE_OVERLAY = '/opt/salemax/releases/retail-cash-reconciliation-4b0c416ea4b5-20261108/compose.retail-cash-reconciliation.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
REPLACED_FILES = {
    'modules/platform/chatbot-handoff-claims.js': '5a0e4cce97d26f932e1f19b6fab498df11149efa5d637ee36bad7137da7c73c5',
    'modules/platform/chatbot-runtime.js': '3ba8d087ca748c16cd403c9ae560aec5f5f263460c5250e13f4c1b4e78966ba6',
}
SCOPE_ENV = 'SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID'
SLUG = 'pro-catalyst-handover'
RELEASE_DATE = '20261109'
NEW_FILES = ()
ADD_SCOPE = True
LIVE_SOURCE_EDITS = {}
MOCKUP_MIGRATION = None

def configure_admissions():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, NEW_FILES
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-handover-55da66d08022-20261109/compose.pro-catalyst-handover.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-runtime.js': '3e8330fb217fc6eabdbe4bb161ad9bda6bfd103bf4ac9c42e6086bda597ecc87',
        'modules/platform/chatbot-lead-capture.js': 'c03dc43fcd428f6f3309ea0b03a67c61c137d8932ba8896431691d681296c6c5',
        'modules/platform/chatbot-ai-prompt.js': '16835d7be66d52851650ea53a36a95b628c36894fe1aef9b79a561240fb909b0',
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID'
    SLUG = 'pro-catalyst-admissions'
    NEW_FILES = ('modules/platform/chatbot-admissions-intake.js',)


def configure_name_question():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-admissions-bf5f7f99f1e5-20261109/compose.pro-catalyst-admissions.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-runtime.js': 'f718d06af7e65fe19d43e4ec1fd4386fea540e5fc45ee6f4aaacce21a545abfe',
        'modules/platform/chatbot-lead-capture.js': '3e759f54f7c7a45f088cadff842d2839d87d80a792d3dcc25f43d0a3ac62524b',
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID'
    SLUG = 'pro-catalyst-name-question'
    ADD_SCOPE = False


def configure_knowledge():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-name-question-e6b9c0cb92b0-20261109/compose.pro-catalyst-name-question.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-runtime.js': 'e83f4c4efdbbd002826d7e76d5f8a289f7ba6aefce8de9f4219a5290d8a47f1e',
        'modules/platform/chatbot-business-context.js': '1d41007b283b7bf9e9116fd0d1e7160740685c616640cb84f696b5600ce911fa',
        'modules/platform/chatbot-admissions-intake.js': '8afb4e65d82020691f5242e6f174f8bd01615b02033fd9d68178ad4d5f05415c',
        'modules/platform/chatbot-lead-capture.js': 'c0dec85c964a15425f35fff6e07c79ff2da35490e3f8b26fc3d028e59db4432b',
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID'
    SLUG = 'pro-catalyst-knowledge'
    ADD_SCOPE = False

def configure_mockup():
    global ACTIVE_OVERLAY, REPLACED_FILES, NEW_FILES, SCOPE_ENV, SLUG, ADD_SCOPE, LIVE_SOURCE_EDITS, MOCKUP_MIGRATION
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-knowledge-4df98d3072f5-20261109/compose.pro-catalyst-knowledge.json'
    REPLACED_FILES = {
        'server.js': 'c880f87da53017f0bd9ea01ebf5c1caf19d485710294c96b36f6ed0438558bc0',
        'helper/inbox/inbox.js': '0eb7df3361c2981f5ffa4f9189db380f9bcaa9e0e2e748e150eb6101cf0834bf',
        'modules/platform/chatbot-runtime.js': '239f3436448eabf55b33a53d6aba40d3bf9c5feb419c7ba89459b7dcfd1506be',
        'modules/platform/chatbot-router.js': '0c0161e869e8ec306451e5e5e56a1eb104b911d875db16c97fc3d04e7d4e920b',
        'modules/platform/mount-existing-upgrade.js': '5fa48001eb09b4969b234c04695221a223852fd5ab6e9e622f773f3a2ed5a941',
        'client/public/chatbot-admin.js': 'b077c0ca36e6774f3795cc1706e5c80d44c326f71648690fbad9716a505b2ccc',
        'client/public/training-sidebar.js': '48b30ebb477945aee82e695cb135668e64b5e2c2e48d0bf6f85416e93e4d7413',
    }
    mount = b"  app.use('/api/workspace/chatgpt',"
    mockup = b"  app.use('/api/workspace/chatbots/mockup',require('./chatbot-mockup').createRouter({pool,authenticate:featureSession.guard}));\n"
    LIVE_SOURCE_EDITS = {
        'modules/platform/mount-existing-upgrade.js': (mount, mockup + mount),
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261104-ai-provider-profiles2', b'/chatbot-admin.js?v=20261109-live-reply-mockup1'),
    }
    MOCKUP_MIGRATION = 'database/migrations/20270130_chatbot_mockup_turns.sql'
    NEW_FILES = ('modules/platform/chatbot-mockup.js', MOCKUP_MIGRATION)
    SCOPE_ENV = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID'
    SLUG = 'pro-catalyst-mockup'
    ADD_SCOPE = False


def configure_mockup_inbox():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE, LIVE_SOURCE_EDITS
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-mockup-562c5d8df75c-20261109/compose.pro-catalyst-mockup.json'
    REPLACED_FILES = {
        'client/public/chatbot-admin.js': 'f97e3fce8dc4345cb156882ea74932d5fa1cfb8179a59f4a9892f5ece5392d85',
        'client/public/training-sidebar.js': '07a1901f89e073282a48bda292a19deec00256e4a60d32411b0f2b6fdcf334f9',
        'modules/platform/chatbot-mockup.js': '2724dbf75fc79d1c23e861e6c17b182c46c3df1d4d58833718bbb47bff8594d1',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261109-live-reply-mockup1', b'/chatbot-admin.js?v=20261109-mockup-inbox1'),
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-mockup-inbox'
    ADD_SCOPE = False


def configure_lead_report_period():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-mockup-inbox-225e5dae2a26-20261109/compose.pro-catalyst-mockup-inbox.json'
    REPLACED_FILES = {
        'helper/pipeline/reports.js': '59c6f588c1725f210f3cc94598f635c6a854a73b3b80349523aecbabcaf5000a',
        'routes/pipeline.js': '91dae787e6b147a491b661ce9068ce29c7c76316be6e09cea077be80e3dae6d6',
        'client/public/pipeline/index.html': '19fa8bd46c774b96d07b2402fcd7be23ed4500e490eda6ce8d555722c36ac8ac',
        'client/public/pipeline/reports.js': '0f6463213a84edd12e32763d013da191339da58c5349b1786886097e0c125a61',
        'modules/platform/chatbot-runtime.js': '9917b1dcfdabed2cca28de4791d1f2099c916f358e87c4427aee14997678d822',
        'modules/platform/chatbot-admissions-intake.js': '1dc9ba707c272603cef4be94457671cceb5b7f0ec77a2a041becc01880a4d858',
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'lead-report-period'
    ADD_SCOPE = False


def configure_followup_preview():
    global ACTIVE_OVERLAY, REPLACED_FILES, NEW_FILES, SCOPE_ENV, SLUG, ADD_SCOPE, LIVE_SOURCE_EDITS, MOCKUP_MIGRATION
    ACTIVE_OVERLAY = '/opt/salemax/releases/lead-report-period-71ed6093d802-20261109/compose.lead-report-period.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-mockup.js': '93c56187bdd05e864dce57b76b31d20127789cf1de1b89bd3563a65ad325476a',
        'client/public/chatbot-admin.js': '04c52e4325296b7946093550f6bb4db136feb7a9df3109f92b32cc53f10ad9d6',
        'client/public/training-sidebar.js': '58438e953a6d9c4975db6ee9f9ea06b5254dcab2b2ab3ad37deec524676b1d85',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261109-mockup-inbox1', b'/chatbot-admin.js?v=20261109-followup-preview1'),
    }
    MOCKUP_MIGRATION = 'database/migrations/20270131_chatbot_followup_previews.sql'
    NEW_FILES = ('modules/platform/chatbot-followup-preview.js', 'modules/platform/chatbot-followup-library.js', MOCKUP_MIGRATION)
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-followup-preview'
    ADD_SCOPE = False


def configure_followup_chat_link():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE, LIVE_SOURCE_EDITS
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-followup-preview-f342a3fee066-20261109/compose.pro-catalyst-followup-preview.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-followup-preview.js': 'e002a271b4f37152fa4720ba559d9a0a55d8946cce33cd976607db08debac763',
        'client/public/chatbot-admin.js': 'beb618d71e6a0e245f17ae7d34251f4153bba886270e80160fff47c77aa9476e',
        'client/public/training-sidebar.js': '7d266e3b8cb438b920004efa41a581e5a8deb3980065667d7b67cb7706c63a74',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261109-followup-preview1', b'/chatbot-admin.js?v=20261109-followup-open-chat1'),
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-followup-chat-link'
    ADD_SCOPE = False


def configure_ad_aware_followups():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE, LIVE_SOURCE_EDITS
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-followup-chat-link-311177232e34-20261109/compose.pro-catalyst-followup-chat-link.json'
    REPLACED_FILES = {
        'helper/addon/qr/processThings.js': 'c375c15d5bcb08f73f388d45f81f84468c04478435cf4f85875bf2eb1059a413',
        'modules/platform/chatbot-runtime.js': '874910453b91534826ffeb8f4616baefa359eb95fe5c5bdba4421daa8b22abc6',
        'modules/platform/chatbot-business-context.js': 'afb21311ba03099f80e6eea27fc0d8ef2d7f7bbdaaee918037cb292a10fea119',
        'modules/platform/chatbot-mockup.js': '0677c40aae7d98c6ec851bd1bc120a44311f2d4f64aaa4210152d358baa5031a',
        'modules/platform/chatbot-followup-preview.js': '845c73dad2ab2c58ef26b9dc1c08666187b3f77236f7f65d1ad881be5408e5f9',
        'client/public/chatbot-admin.js': '4b8f35e68af2a8893cd8c7e014c49f810c335a54670345ffb563b0968e10a525',
        'client/public/training-sidebar.js': '1dc02500138f33f716c85c596475dc6e25a08e0f45369c80b49e0a5a21054f4d',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261109-followup-open-chat1', b'/chatbot-admin.js?v=20261109-ad-aware-followup1'),
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-ad-aware-followups'
    ADD_SCOPE = False


def configure_ad_overview():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-ad-aware-followups-09d85ddf3a55-20261109/compose.pro-catalyst-ad-aware-followups.json'
    REPLACED_FILES = {'modules/platform/chatbot-runtime.js': 'dfdc133a01dafd0f8dab8dffd304409470ddeb8380e1a426f4cbfab5fbf91b16'}
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-ad-overview'
    ADD_SCOPE = False


def configure_test_replies():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE, LIVE_SOURCE_EDITS
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-ad-overview-905d035678c2-20261109/compose.pro-catalyst-ad-overview.json'
    REPLACED_FILES = {
        'client/public/chatbot-admin.js': '23b4de2f6c4640a297597560c0457ca222da6375894041a7fc350d65168bd66f',
        'client/public/training-sidebar.js': 'c73c6df27b6831630238b99458c5e1b56ad74c314a3f7de9ca453885d44092ed',
        'helper/inbox/inbox.js': 'eae5db58f750a47f7f9c3f2e772bd876f0bc9d9968b72828d63f4170154cae00',
        'modules/platform/chatbot-ai-prompt.js': '5f1437b936effc026f1be12f6c8012ad6001036c2ce098feb8f26ddeb7cb26e6',
        'modules/platform/chatbot-business-context.js': '7bdf501bf6a2a88110d5c12af36fe4c111c233c9e196efa574d2cf1b82fb4d8c',
        'modules/platform/chatbot-lead-capture.js': '820bdcff2817dfdefd2c66c3ce4825db346346c262486da648878596b5bc7fda',
        'modules/platform/chatbot-mockup.js': '6ed4ee0ad1a32cc7c28a4dfac2632c3a011fa31b57600a277fc9d918cf46178f',
        'modules/platform/chatbot-runtime.js': 'b510d3ec50cad28b1194ef28f0ccd7692cec8708b72dc42f7cdf05c1b8efb1d3',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261109-ad-aware-followup1', b'/chatbot-admin.js?v=20261109-test-replies1'),
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-test-replies'
    ADD_SCOPE = False


def configure_mockup_scroll():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, RELEASE_DATE, ADD_SCOPE, LIVE_SOURCE_EDITS
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-test-replies-029e6def676a-20261109/compose.pro-catalyst-test-replies.json'
    REPLACED_FILES = {
        'client/public/chatbot-admin.js': '969ef4785181b1d2a02abe7ae7124a5b6f83b365f1fe4d94a2369ed5a3be15ad',
        'client/public/training-sidebar.js': 'f45331670dc5e0b64098d84152172d5a0e72f6233b95ca18a0a8e5f4e7ada66b',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261109-test-replies1', b'/chatbot-admin.js?v=20261110-mockup-scroll1'),
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-mockup-scroll'
    RELEASE_DATE = '20261110'
    ADD_SCOPE = False


def configure_course_certification():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, RELEASE_DATE, ADD_SCOPE, LIVE_SOURCE_EDITS
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-mockup-scroll-af2216c33db4-20261110/compose.pro-catalyst-mockup-scroll.json'
    REPLACED_FILES = {
        'client/public/index.html': '945c9a9b7ff09a7e5ca0b0110af5c2feb6ed155dbef0b2edfc31c93bc5c550c5',
        'client/public/training-courses.js': '511e8e4419b5e2cc24b30c02298c5bb4580322be9e6853235fb9fa44375f73d1',
        'modules/platform/chatbot-business-context.js': '31816df4151badc1412ecfb4686a9257afcd43567a7bd729959fdea00a9e755c',
        'modules/platform/chatbot-lead-capture.js': 'ad572f33566478d081cee52373175628be79b8b6eca990396452dc2ffc10e026',
        'modules/platform/chatbot-runtime.js': '96df24b364d5367c7b6205b04c9dc3f29f1c88b93d1ba22686e5f28c52415616',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/index.html': (b'/training-courses.js?v=20261107-retail-catalogue1', b'/training-courses.js?v=20261110-course-certification1'),
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'course-certification'
    RELEASE_DATE = '20261110'
    ADD_SCOPE = False


def configure_course_opening():
    global ACTIVE_OVERLAY, REPLACED_FILES, NEW_FILES, SCOPE_ENV, SLUG, RELEASE_DATE, ADD_SCOPE, LIVE_SOURCE_EDITS
    ACTIVE_OVERLAY = '/opt/salemax/releases/course-certification-51ecb52a4e72-20261110/compose.course-certification.json'
    REPLACED_FILES = {
        'client/public/chatbot-admin.js': '4ad60fcba1e4a5c75b790417d402dbca0cba1722c7531fd5627cbe7a3f7112f3',
        'client/public/training-sidebar.js': 'c2961a6ad538fe3596b81f9c1305dd1dec3cb56027c7308d2015e547d99a4cda',
        'modules/platform/chatbot-mockup.js': '49bfba4cfcd7fad8feec727319ddf66abd798577215fc18595009d190cee7c76',
        'modules/platform/chatbot-runtime.js': 'd31325ba8fe1681ef797484683dfe2ed5f2629d40de36721c4b3c0878a987139',
    }
    NEW_FILES = ('modules/platform/chatbot-course-opening.js',)
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261110-mockup-scroll1', b'/chatbot-admin.js?v=20261110-course-opening1'),
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-course-opening'
    RELEASE_DATE = '20261110'
    ADD_SCOPE = False


def configure_followup_delivery():
    global ACTIVE_OVERLAY, REPLACED_FILES, NEW_FILES, SCOPE_ENV, SLUG, RELEASE_DATE, ADD_SCOPE, LIVE_SOURCE_EDITS, MOCKUP_MIGRATION
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-course-opening-f9021ef914fd-20261110/compose.pro-catalyst-course-opening.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-mockup.js': 'e85479804db23aaf96ce6369cecf838332001a70087a87b2c36f324078817b69',
        'modules/platform/chatbot-followup-preview.js': '2a6ece459a2e7ed4a52d87e9cbb94dfa1bf92d5300e8a49272b14e5b87f9c8f6',
        'client/public/chatbot-admin.js': '0a76fc421e7e66f7008cc0473ba7094b008b8a8f16fee0777f8c716087b79ec0',
        'client/public/training-sidebar.js': '0b5467b287e7ffae6832932d4ad8101f93474f2d49780dede9466a1b3270a6fa',
    }
    LIVE_SOURCE_EDITS = {
        'client/public/training-sidebar.js': (b'/chatbot-admin.js?v=20261110-course-opening1', b'/chatbot-admin.js?v=20261110-followup-delivery1'),
    }
    MOCKUP_MIGRATION = 'database/migrations/20270201_chatbot_followup_delivery.sql'
    NEW_FILES = ('modules/platform/chatbot-followup-delivery.js', MOCKUP_MIGRATION)
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-followup-delivery'
    RELEASE_DATE = '20261110'
    ADD_SCOPE = False


def configure_followup_queue_fix():
    global ACTIVE_OVERLAY, REPLACED_FILES, NEW_FILES, SCOPE_ENV, SLUG, RELEASE_DATE, ADD_SCOPE, LIVE_SOURCE_EDITS, MOCKUP_MIGRATION
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-followup-delivery-bda7619a1615-20261110/compose.pro-catalyst-followup-delivery.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-followup-delivery.js': '3b6706ef85814039ee6ba88426b0dbb8b4c7b1dedf3b32075ad7d68391f1dea7',
    }
    NEW_FILES = ()
    LIVE_SOURCE_EDITS = {}
    MOCKUP_MIGRATION = None
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-followup-queue-fix'
    RELEASE_DATE = '20261110'
    ADD_SCOPE = False


def configure_followup_inbox_parity():
    global ACTIVE_OVERLAY, REPLACED_FILES, NEW_FILES, SCOPE_ENV, SLUG, RELEASE_DATE, ADD_SCOPE, LIVE_SOURCE_EDITS, MOCKUP_MIGRATION
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-followup-queue-fix-f2b10448025b-20261110/compose.pro-catalyst-followup-queue-fix.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-followup-delivery.js': 'd5a0cc1fb532429df41bcf343a9aaffca2b297d54651199a4f1cfeba8e685c90',
    }
    NEW_FILES = ()
    LIVE_SOURCE_EDITS = {}
    MOCKUP_MIGRATION = None
    SCOPE_ENV = 'SALEMAX_CHATBOT_MOCKUP_TENANT_ID'
    SLUG = 'pro-catalyst-followup-inbox-parity'
    RELEASE_DATE = '20261110'
    ADD_SCOPE = False


def apply_mockup_migration(source):
    script = """const fs = require('node:fs');
    const crypto = require('node:crypto');
    const runner = require('/app/database/migration-runner');
    const pool = require('/app/database/config').promise();
    const file = process.argv[1];
    const source = fs.readFileSync(0, 'utf8');
    (async () => {
      const migrations = runner.discover('/app/database/migrations');
      migrations.push({ file, checksum: crypto.createHash('sha256').update(source).digest('hex'), statements: runner.splitSql(source) });
      const db = await pool.getConnection();
      try { console.log(JSON.stringify(await runner.applyMigrations(db, migrations, { only: file }))); }
      finally { db.release(); }
    })().catch(error => { console.error(error.code || 'MIGRATION_FAILED'); process.exitCode = 1; }).finally(() => pool.end());"""
    result = subprocess.run(['docker', 'exec', '-i', APP, 'node', '-e', script, Path(MOCKUP_MIGRATION).name],
                            input=source.decode('utf8'), capture_output=True, text=True)
    if result.returncode:
        code = result.stderr.strip()
        raise RuntimeError('Mockup migration failed: ' + (code if re.fullmatch(r'[A-Z0-9_]{1,80}', code) else 'MIGRATION_FAILED'))
    return json.loads(result.stdout.splitlines()[-1])


EXPECTED_IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
SUPPORT = (
    'salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
    'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db',
)


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for name in env_files:
        args += ['--env-file', name]
    for name in files:
        args += ['-f', name]
    return args


def wait_healthy():
    for _ in range(45):
        current = inspect(APP)
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_production_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def deploy(stage, commit):
    require_production_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if not all((stage / name).is_file() for name in (*REPLACED_FILES, *NEW_FILES)):
        raise RuntimeError('Staging directory is missing reviewed chatbot files')
    os.umask(0o077)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or files[-1] != ACTIVE_OVERLAY:
        raise RuntimeError('Active app overlay differs from the reviewed baseline')
    if not env_files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')

    release = ROOT / 'releases' / f'{SLUG}-{commit[:12]}-{RELEASE_DATE}'
    backup = ROOT / 'shared' / f'rollback-{SLUG}-{commit[:12]}-{RELEASE_DATE}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))

    manual = json.loads(PRIOR_VARS.read_text())
    supplied = {key for name in env_files for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in files for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live_env:
            variables[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable')
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    env = dict(os.environ, **variables)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    changed = {}
    for name, expected in REPLACED_FILES.items():
        target = '/app/' + name
        if run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
            raise RuntimeError('Live file changed: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Preimage copy changed: ' + name)
        data = (stage / name).read_bytes()
        if name in LIVE_SOURCE_EDITS:
            old, new = LIVE_SOURCE_EDITS[name]
            live = saved.read_bytes()
            if live.count(old) != 1 or new not in data:
                raise RuntimeError('Cannot apply reviewed live source edit: ' + name)
            data = live.replace(old, new)
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    for name in NEW_FILES:
        run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name)
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    tenant_id = (stage / 'tenant-id').read_text().strip()
    if not re.fullmatch(r'[a-f0-9-]{36}', tenant_id):
        raise RuntimeError('Invalid tenant scope')
    tenant_check = """const db = require('/app/database/config').promise();
    db.query("SELECT COUNT(*) AS n FROM sx_tenants WHERE id=? AND name='Pro Catalyst' AND category_key='training_center' AND status='active'", [process.argv[1]])
      .then(([[row]]) => { if (Number(row.n) !== 1) process.exitCode = 1; })
      .catch(() => { process.exitCode = 1; }).finally(() => db.end());"""
    run('docker', 'exec', APP, 'node', '-e', tenant_check, tenant_id)
    if ADD_SCOPE and SCOPE_ENV in live_env:
        raise RuntimeError('Tenant scope is already configured')
    if not ADD_SCOPE and live_env.get(SCOPE_ENV) != tenant_id:
        raise RuntimeError('Active admissions tenant differs from the reviewed scope')
    if NEW_FILES and live_env.get('SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID') != tenant_id:
        raise RuntimeError('Admissions tenant differs from the active handoff tenant')

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / f'compose.{SLUG}.json'
    overlay_app = {'image': app['Config']['Image'], 'volumes': mounts}
    extra_env = {SCOPE_ENV: tenant_id} if ADD_SCOPE else {}
    if SLUG == 'pro-catalyst-mockup':
        owner_check = """console.log = () => {};
        const db = require('/app/database/config').promise();
        require('/app/modules/platform/chatbot-owner-uid').legacyOwnerUidForTenant(db, process.argv[1])
          .then(uid => process.stdout.write(require('node:crypto').createHash('sha256').update(uid).digest('hex')))
          .catch(() => { process.exitCode = 1; }).finally(() => db.end());"""
        owner_hash = run('docker', 'exec', APP, 'node', '-e', owner_check, tenant_id).strip()
        if not re.fullmatch(r'[a-f0-9]{64}', owner_hash):
            raise RuntimeError('Active owner scope could not be verified')
        extra_env.update(SALEMAX_CHATBOT_MOCKUP_TENANT_ID=tenant_id, SALEMAX_CHATBOT_MOCKUP_OWNER_HASH=owner_hash)
    if SLUG == 'pro-catalyst-followup-preview':
        extra_env['SALEMAX_CHATBOT_FOLLOWUP_PREVIEW_SINCE'] = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
    if extra_env:
        if set(extra_env) & live_env.keys():
            raise RuntimeError('A target environment override already exists')
        overlay_app['environment'] = extra_env
    overlay.write_text(json.dumps({'services': {'app': overlay_app}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    old_app, new_app = before['services']['app'], after['services']['app']
    old_volumes = {row['target']: row for row in old_app['volumes']}
    new_volumes = {row['target']: row for row in new_app['volumes']}
    expected_volumes = dict(old_volumes, **{row['target']: row for row in mounts})
    if set(new_volumes) != set(expected_volumes):
        raise RuntimeError('Unexpected app mount targets')
    for target, row in new_volumes.items():
        expected = expected_volumes[target]
        if (row['type'], row.get('source'), row.get('read_only')) != (expected['type'], expected.get('source'), expected.get('read_only')):
            raise RuntimeError('Unexpected app mount: ' + target)
    old_app.pop('volumes')
    new_app.pop('volumes')
    for key, value in extra_env.items():
        if new_app['environment'].pop(key, None) != value:
            raise RuntimeError('Expected tenant scope is missing')
    if before != after:
        raise RuntimeError('Candidate changes non-mount Compose configuration')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    helper = release / 'deploy/pro-catalyst-handover-release.py'
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)

    if SLUG == 'pro-catalyst-handover':
        reset_script = release / 'deploy/pro-catalyst-handover-reset.cjs'
        reset_script.write_bytes((stage / 'deploy/pro-catalyst-handover-reset.cjs').read_bytes())
        reset_script.chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    if MOCKUP_MIGRATION:
        migration = apply_mockup_migration(changed[MOCKUP_MIGRATION])
        (backup / 'mockup-migration.json').write_text(json.dumps(migration) + '\n')
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        if any(key + '=' + value not in current['Config']['Env'] for key, value in {SCOPE_ENV: tenant_id, **extra_env}.items()):
            raise RuntimeError('Live app is missing the handoff tenant scope')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'hashes': {name: sha(data) for name, data in changed.items()}}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_production_lock()
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / f'compose.{SLUG}.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later release is active; roll it back first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['Image']:
        raise RuntimeError('Rollback app image mismatch')
    for name, expected in REPLACED_FILES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + name)
    for name in NEW_FILES:
        run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True}))


def reset(backup):
    require_production_lock()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / f'compose.{SLUG}.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlay):
        raise RuntimeError('Expected handoff overlay is not active')
    source = (release / 'deploy/pro-catalyst-handover-reset.cjs').read_text()
    os.umask(0o077)
    with subprocess.Popen(['docker', 'exec', '-i', APP, 'node', '-e', source],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True) as process:
        first = json.loads(process.stdout.readline())
        if 'preimage' not in first:
            raise RuntimeError('Reset preflight failed: ' + first.get('error', 'UNKNOWN'))
        snapshot = backup / 'handoff-preimage.json'
        with snapshot.open('x') as saved:
            json.dump(first['preimage'], saved)
            saved.flush()
            os.fsync(saved.fileno())
        final, _ = process.communicate('PREIMAGE_SAVED\n', timeout=30)
        result = json.loads(final)
        if process.returncode or 'totals' not in result:
            raise RuntimeError('Handoff reset failed: ' + result.get('error', 'UNKNOWN'))
        result['preimageSha256'] = sha(snapshot.read_bytes())
        (backup / 'handoff-reset-result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] in ('deploy', 'deploy-admissions', 'deploy-name-question', 'deploy-knowledge', 'deploy-mockup', 'deploy-mockup-inbox', 'deploy-lead-report-period', 'deploy-followup-preview', 'deploy-followup-chat-link', 'deploy-ad-aware-followups', 'deploy-ad-overview', 'deploy-test-replies', 'deploy-mockup-scroll', 'deploy-course-certification', 'deploy-course-opening', 'deploy-followup-delivery', 'deploy-followup-queue-fix', 'deploy-followup-inbox-parity'):
        if sys.argv[1] == 'deploy-admissions':
            configure_admissions()
        elif sys.argv[1] == 'deploy-name-question':
            configure_name_question()
        elif sys.argv[1] == 'deploy-knowledge':
            configure_knowledge()
        elif sys.argv[1] == 'deploy-mockup':
            configure_mockup()
        elif sys.argv[1] == 'deploy-mockup-inbox':
            configure_mockup_inbox()
        elif sys.argv[1] == 'deploy-lead-report-period':
            configure_lead_report_period()
        elif sys.argv[1] == 'deploy-followup-preview':
            configure_followup_preview()
        elif sys.argv[1] == 'deploy-followup-chat-link':
            configure_followup_chat_link()
        elif sys.argv[1] == 'deploy-ad-aware-followups':
            configure_ad_aware_followups()
        elif sys.argv[1] == 'deploy-ad-overview':
            configure_ad_overview()
        elif sys.argv[1] == 'deploy-test-replies':
            configure_test_replies()
        elif sys.argv[1] == 'deploy-mockup-scroll':
            configure_mockup_scroll()
        elif sys.argv[1] == 'deploy-course-certification':
            configure_course_certification()
        elif sys.argv[1] == 'deploy-course-opening':
            configure_course_opening()
        elif sys.argv[1] == 'deploy-followup-delivery':
            configure_followup_delivery()
        elif sys.argv[1] == 'deploy-followup-queue-fix':
            configure_followup_queue_fix()
        elif sys.argv[1] == 'deploy-followup-inbox-parity':
            configure_followup_inbox_parity()
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'reset':
        reset(Path(sys.argv[2]))
    elif len(sys.argv) == 3 and sys.argv[1] in ('restore', 'restore-admissions', 'restore-name-question', 'restore-knowledge', 'restore-mockup', 'restore-mockup-inbox', 'restore-lead-report-period', 'restore-followup-preview', 'restore-followup-chat-link', 'restore-ad-aware-followups', 'restore-ad-overview', 'restore-test-replies', 'restore-mockup-scroll', 'restore-course-certification', 'restore-course-opening', 'restore-followup-delivery', 'restore-followup-queue-fix', 'restore-followup-inbox-parity'):
        if sys.argv[1] == 'restore-admissions':
            configure_admissions()
        elif sys.argv[1] == 'restore-name-question':
            configure_name_question()
        elif sys.argv[1] == 'restore-knowledge':
            configure_knowledge()
        elif sys.argv[1] == 'restore-mockup':
            configure_mockup()
        elif sys.argv[1] == 'restore-mockup-inbox':
            configure_mockup_inbox()
        elif sys.argv[1] == 'restore-lead-report-period':
            configure_lead_report_period()
        elif sys.argv[1] == 'restore-followup-preview':
            configure_followup_preview()
        elif sys.argv[1] == 'restore-followup-chat-link':
            configure_followup_chat_link()
        elif sys.argv[1] == 'restore-ad-aware-followups':
            configure_ad_aware_followups()
        elif sys.argv[1] == 'restore-ad-overview':
            configure_ad_overview()
        elif sys.argv[1] == 'restore-test-replies':
            configure_test_replies()
        elif sys.argv[1] == 'restore-mockup-scroll':
            configure_mockup_scroll()
        elif sys.argv[1] == 'restore-course-certification':
            configure_course_certification()
        elif sys.argv[1] == 'restore-course-opening':
            configure_course_opening()
        elif sys.argv[1] == 'restore-followup-delivery':
            configure_followup_delivery()
        elif sys.argv[1] == 'restore-followup-queue-fix':
            configure_followup_queue_fix()
        elif sys.argv[1] == 'restore-followup-inbox-parity':
            configure_followup_inbox_parity()
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: pro-catalyst-handover-release.py deploy[-admissions|-name-question|-knowledge|-mockup|-mockup-inbox|-lead-report-period|-followup-preview|-followup-chat-link|-ad-aware-followups|-ad-overview|-test-replies|-mockup-scroll|-course-certification|-course-opening|-followup-delivery|-followup-queue-fix|-followup-inbox-parity] <stage> <commit> | reset <backup> | restore[-admissions|-name-question|-knowledge|-mockup|-mockup-inbox|-lead-report-period|-followup-preview|-followup-chat-link|-ad-aware-followups|-ad-overview|-test-replies|-mockup-scroll|-course-certification|-course-opening|-followup-delivery|-followup-queue-fix|-followup-inbox-parity] <backup>')
