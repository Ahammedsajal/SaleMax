'use strict';

const { removeContact } = require('./contact-records');

function createContactDeleteHandler(query, dependencies = {}) {
  const inboxScope = require('./team-inbox-scope');
  const resolveInboxScope = dependencies.resolveInboxScope || inboxScope.resolveInboxScope;
  const authorizeInboxFeature = dependencies.authorizeInboxFeature || inboxScope.authorizeInboxFeature;
  const authorizeInboxPayload = dependencies.authorizeInboxPayload || inboxScope.authorizeInboxPayload;
  const resolveFeatureSession = dependencies.resolveFeatureSession || ((actor) =>
    require('./business-feature-session').resolve(
      dependencies.pool || require('../../database/config').promise(),
      { actor },
    ));
  return async (req, res) => {
    try {
      const actor = req.decode?.userData || req.decode;
      const scope = await resolveInboxScope(query, actor, 'del_contact');
      if (scope.canonical) {
        const session = req.featureSession || await resolveFeatureSession(actor);
        await authorizeInboxFeature(scope, 'del_contact', session);
      }
      const authorized = await authorizeInboxPayload(query, scope, 'del_contact', { id: req.body?.id }, actor);
      await removeContact(query, authorized.ownerUid, authorized.contactId);
      return res.json({ success: true, msg: 'Contact was deleted' });
    } catch (error) {
      if (['INVALID_CONTACT_ID', 'INVALID_CONTACT_SCOPE'].includes(error.code)) {
        return res.status(400).json({ success: false, code: error.code });
      }
      return res.status(500).json({ success: false, code: 'CONTACT_DELETE_FAILED', msg: 'Contact could not be deleted.' });
    }
  };
}

module.exports = createContactDeleteHandler;
