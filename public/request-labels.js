export function studentRequestLabel(path) {
  if (path === '/api/config') return 'Loading student activity settings…';
  if (path === '/api/auth/student/preview') return 'Checking activity details…';
  if (path === '/api/auth/student/join') return 'Opening your activity…';
  if (path === '/api/me/logout') return 'Signing out…';
  if (path.endsWith('/terminal')) return 'Starting your program…';
  if (path.endsWith('/submit')) return 'Submitting your answer…';
  if (path.endsWith('/draft')) return 'Saving your answer…';
  if (path === '/api/me/finalize') return 'Submitting your saved answers…';
  if (path === '/api/me/results') return 'Checking whether your score is ready…';
  if (path === '/api/me/session') return 'Loading your saved progress…';
  if (path.includes('/missions/')) return 'Loading activity questions…';
  return 'Updating your activity…';
}

export function facultyRequestLabel(path, method = 'GET') {
  if (path === '/api/config') return 'Loading Faculty Studio settings…';
  if (path === '/api/instructor/login') return 'Signing in to Faculty Studio…';
  if (path === '/api/instructor/logout') return 'Signing out of Faculty Studio…';
  if (path.endsWith('/materials/extract')) return 'Reading your teaching material…';
  if (path.endsWith('/ai/regenerate')) return 'Regenerating invalid question…';
  if (path.endsWith('/ai/propose') || path.endsWith('/ai/generate')) return 'Generating activity questions…';
  if (path.endsWith('/ai/approved-draft') || path.endsWith('/ai/draft')) return 'Saving approved activity draft…';
  if (path.endsWith('/ai/status')) return 'Checking question generator availability…';
  if (path.endsWith('/ai/proposal')) return method === 'GET' ? 'Restoring generated questions…'
    : method === 'DELETE' ? 'Clearing saved question preview…' : 'Saving question review progress…';
  if (path.includes('/ai/check/')) return 'Checking questions against teaching material…';
  if (path.endsWith('/ai/inspect') || path.endsWith('/validate')) return 'Checking activity questions and rules…';
  if (path.endsWith('/publish-scores')) return path.includes('/students/') ? 'Sharing the student’s score…' : 'Sharing scores for students who have finished…';
  if (path.endsWith('/publish')) return 'Publishing the activity…';
  if (path.endsWith('/results')) return 'Loading student scores and participation…';
  if (path.endsWith('/export.csv')) return 'Preparing the score file…';
  if (path.endsWith('/extend')) return 'Adding time for the student…';
  if (path.endsWith('/reopen')) return 'Allowing the student to continue answering…';
  if (path.includes('/scores/')) return method === 'DELETE' ? 'Removing the faculty grade and using the original score…' : 'Saving question score adjustment…';
  if (path.includes('/proctor-access')) return method === 'GET' ? 'Loading proctor access settings…'
    : method === 'DELETE' ? 'Removing proctor access…' : 'Creating proctor access code…';
  if (path.endsWith('/pin')) return 'Saving the activity PIN…';
  if (path.endsWith('/name')) return 'Saving the class activity name…';
  if (path === '/api/instructor/runs') return method === 'POST' ? 'Assigning the activity to a class…' : 'Loading assigned class activities…';
  if (path.includes('/sources')) return method === 'GET' ? 'Loading teaching material…'
    : method === 'POST' ? 'Uploading teaching material…' : 'Saving source notes…';
  if (path.includes('/classes')) {
    if (method === 'DELETE') return path.includes('/students/') ? 'Removing student from class…' : 'Deleting class…';
    return method === 'GET' ? 'Loading the student list…' : 'Saving the student list…';
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
  if (path === '/api/auth/proctor/join') return 'Opening the activity monitor…';
  if (path === '/api/proctor/run') return 'Loading student participation and progress…';
  if (path === '/api/proctor/logout') return 'Signing out…';
  return 'Updating the activity monitor…';
}
