export function studentRequestLabel(path) {
  if (path === '/api/config') return 'Loading student activity settings…';
  if (path === '/api/auth/student/preview') return 'Checking activity details…';
  if (path === '/api/auth/student/join') return 'Opening your attempt…';
  if (path === '/api/me/logout') return 'Signing out of your attempt…';
  if (path.endsWith('/submit')) return 'Submitting your answer…';
  if (path.endsWith('/draft')) return 'Saving your answer draft…';
  if (path === '/api/me/finalize') return 'Finishing your attempt…';
  if (path === '/api/me/results') return 'Checking for your published score…';
  if (path === '/api/me/session') return 'Loading your saved progress…';
  if (path.includes('/missions/')) return 'Loading activity questions…';
  return 'Updating your activity…';
}

export function facultyRequestLabel(path, method = 'GET') {
  if (path === '/api/config') return 'Loading Faculty Studio settings…';
  if (path === '/api/instructor/login') return 'Signing in to Faculty Studio…';
  if (path === '/api/instructor/logout') return 'Signing out of Faculty Studio…';
  if (path.endsWith('/materials/extract')) return 'Extracting teaching material…';
  if (path.endsWith('/ai/propose') || path.endsWith('/ai/generate')) return 'Generating activity questions…';
  if (path.endsWith('/ai/approved-draft') || path.endsWith('/ai/draft')) return 'Saving approved activity draft…';
  if (path.endsWith('/ai/status')) return 'Checking question generator availability…';
  if (path.endsWith('/ai/proposal')) return method === 'GET' ? 'Restoring generated questions…'
    : method === 'DELETE' ? 'Clearing saved question preview…' : 'Saving question review progress…';
  if (path.includes('/ai/check/')) return 'Checking questions against teaching material…';
  if (path.endsWith('/ai/inspect') || path.endsWith('/validate')) return 'Checking activity questions and rules…';
  if (path.endsWith('/publish-scores')) return path.includes('/students/') ? 'Publishing student score…' : 'Publishing completed student scores…';
  if (path.endsWith('/publish')) return 'Publishing activity version…';
  if (path.endsWith('/results')) return 'Loading student scores and participation…';
  if (path.endsWith('/export.csv')) return 'Preparing gradebook export…';
  if (path.endsWith('/extend')) return 'Extending student attempt time…';
  if (path.endsWith('/reopen')) return 'Reopening student attempt…';
  if (path.includes('/scores/')) return method === 'DELETE' ? 'Restoring automatic question score…' : 'Saving question score adjustment…';
  if (path.includes('/proctor-access')) return method === 'GET' ? 'Loading proctor access settings…'
    : method === 'DELETE' ? 'Revoking proctor access…' : 'Creating proctor access code…';
  if (path.endsWith('/pin')) return 'Updating student admission PIN…';
  if (path.endsWith('/name')) return 'Saving run name…';
  if (path === '/api/instructor/runs') return method === 'POST' ? 'Creating activity run…' : 'Loading activity runs…';
  if (path.includes('/sources')) return method === 'GET' ? 'Loading teaching material…'
    : method === 'POST' ? 'Uploading teaching material…' : 'Saving source notes…';
  if (path.includes('/classes')) {
    if (method === 'DELETE') return path.includes('/students/') ? 'Removing student from class…' : 'Deleting class…';
    return method === 'GET' ? 'Loading class roster…' : 'Saving class roster…';
  }
  if (path.includes('/students/')) return 'Loading student answers and scores…';
  if (path.endsWith('/archive')) return 'Archiving activity draft…';
  if (path.endsWith('/restore')) return 'Restoring activity draft…';
  if (path.endsWith('/clone')) return 'Creating editable activity copy…';
  if (path === '/api/instructor/assessments') return method === 'GET' ? 'Loading activity library…' : 'Importing activity draft…';
  if (path.includes('/assessments/')) return method === 'GET' ? 'Loading activity questions and rules…' : 'Saving activity changes…';
  return 'Updating Faculty Studio…';
}

export function proctorRequestLabel(path) {
  if (path === '/api/config') return 'Loading proctor settings…';
  if (path === '/api/auth/proctor/join') return 'Signing in to the run monitor…';
  if (path === '/api/proctor/run') return 'Loading student participation and progress…';
  if (path === '/api/proctor/logout') return 'Signing out of the run monitor…';
  return 'Updating the run monitor…';
}
