(() => {
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('team-invite');
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      window.__sxTeamInviteToken = token;
      sessionStorage.setItem('sx_team_invite_token', token);
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (_) {}
})();
