import { useEffect, useMemo, useState } from 'react'
import { BarChart3, BellRing, BookOpen, ClipboardCheck, Copy, Download, FileText, Layers3, Link2, LogIn, MessageSquareText, School, ShieldCheck, Users } from 'lucide-react'
import { dataChain, learningTracks, stagesForSubject, workspaceRoles } from '../data/audience'
import { learningPlan } from '../data/learningPlan'
import { subjects } from '../data/catalog'
import { questionInventory } from '../data/questionBank'
import { sharedAccountRequest } from '../lib/sharedAccount'

function topicOptions(subjectId) {
  const planIds = {
    physics: 'physics-9702',
    'igcse-physics': 'physics-0625',
    math: 'math-9709',
    'further-math': 'math-9231',
    chemistry: 'chemistry-9701',
    economics: 'economics-9708',
    biology: 'biology-9700',
    'igcse-biology': 'biology-0610',
    'igcse-math': 'math-0580',
    'additional-math': 'math-0606',
  }
  const subject = learningPlan.subjects.find((item) => item.id === (planIds[subjectId] || subjectId))
  return subject?.knowledgeGroupIds.map((id) => learningPlan.knowledgeGroups.find((group) => group.id === id)).filter(Boolean) || []
}

export function RoleWorkspace({ profile, updateProfile, assignments, classrooms, submissions = [], serverSummaries, learningProgress, account, onRefreshAccount, onCreateClassroom, onJoinClassroom, onCreateAssignment, onStartAssignedAssignment }) {
  const [assignmentDraft, setAssignmentDraft] = useState({ classroomId: '', subjectId: 'physics', stage: 'AS', topicId: 'physics-9702-topic-03', title: '', dueDate: '' })
  const [copiedId, setCopiedId] = useState('')
  const [teacherTab, setTeacherTab] = useState('home')
  const [schoolTab, setSchoolTab] = useState('overview')
  const selectedSubject = subjects.find((subject) => subject.id === assignmentDraft.subjectId) || subjects[0]
  const topics = topicOptions(assignmentDraft.subjectId)
  const teacherClasses = classrooms.filter((classroom) => ['owner', 'teacher'].includes(classroom.role))

  async function assignmentAction(resource, options) {
    if (!account?.token) throw new Error('Sign in with your IELTS-ist account to use teacher tools.')
    const result = await sharedAccountRequest(account.token, resource, options)
    if (options?.method && options.method !== 'GET') await onRefreshAccount?.()
    return result
  }

  function changeSubject(subjectId) {
    const nextSubject = subjects.find((subject) => subject.id === subjectId)
    const nextTopics = topicOptions(subjectId)
    setAssignmentDraft((current) => ({
      ...current,
      subjectId,
      stage: stagesForSubject(nextSubject?.code).includes(current.stage) ? current.stage : stagesForSubject(nextSubject?.code)[0],
      topicId: nextTopics[0]?.id || '',
    }))
  }

  function chooseClassroom(classroomId) {
    setAssignmentDraft((current) => ({ ...current, classroomId }))
  }

  async function copyAssignment(assignment) {
    try { await navigator.clipboard.writeText(assignment.id) } catch { /* Clipboard may be unavailable in an embedded browser. */ }
    setCopiedId(assignment.id)
    window.setTimeout(() => setCopiedId(''), 1800)
  }

  return (
    <section className="workspace-view page-band">
      <header className="workspace-hero">
        <div>
          <p className="section-label">Workspace design</p>
          <h1>{profile.role === 'student' ? 'Make today\'s next decision clear.' : profile.role === 'teacher' ? 'Turn evidence into a teachable next step.' : 'See where the programme needs attention.'}</h1>
          <p>{profile.role === 'student' ? 'Your stage controls the papers, topics and difficulty that Coach recommends.' : 'The same question-level records power student practice, teacher review and school reporting.'}</p>
        </div>
        <div className="role-switcher" aria-label="Choose workspace role">
          {workspaceRoles.map((role) => <button type="button" className={profile.role === role.id ? 'active' : ''} key={role.id} onClick={() => { updateProfile({ role: role.id }); if (role.id === 'teacher') setTeacherTab('home'); if (role.id === 'school') setSchoolTab('overview') }}><strong>{role.label}</strong><small>{role.description}</small></button>)}
        </div>
      </header>

      <SharedAccountPanel account={account} classrooms={classrooms} onRefreshAccount={onRefreshAccount} onCreateClassroom={onCreateClassroom} onJoinClassroom={onJoinClassroom} />

      {profile.role === 'student' && <><StudentRoute profile={profile} updateProfile={updateProfile} /><StudentAssignments assignments={assignments} onStart={onStartAssignedAssignment} /></>}
      {profile.role === 'teacher' && <><WorkspaceSubnav label="Teacher workspace" active={teacherTab} onChange={setTeacherTab} items={[['home', 'Home'], ['classes', 'Classes'], ['assignments', 'Assignments'], ['insights', 'Insights'], ['review', 'Review'], ['content', 'Content']]} />{teacherTab === 'home' && <TeacherHome assignments={assignments} submissions={submissions} serverSummaries={serverSummaries} learningProgress={learningProgress} />}{teacherTab === 'classes' && <TeacherClasses classrooms={teacherClasses} serverSummaries={serverSummaries} />}{teacherTab === 'assignments' && <TeacherRoute profile={profile} updateProfile={updateProfile} assignments={assignments} assignmentDraft={assignmentDraft} setAssignmentDraft={setAssignmentDraft} selectedSubject={selectedSubject} topics={topics} changeSubject={changeSubject} chooseClassroom={chooseClassroom} teacherClasses={teacherClasses} copyAssignment={copyAssignment} copiedId={copiedId} onCreateAssignment={onCreateAssignment} account={account} onAssignmentAction={assignmentAction} />}{teacherTab === 'insights' && <TeacherInsights submissions={submissions} />}{teacherTab === 'review' && <TeacherReview submissions={submissions} assignments={assignments} onAssignmentAction={assignmentAction} />}{teacherTab === 'content' && <TeacherContent />}</>}
      {profile.role === 'school' && <><WorkspaceSubnav label="School workspace" active={schoolTab} onChange={setSchoolTab} items={[['overview', 'Overview'], ['cohorts', 'Cohorts'], ['health', 'Programme Health'], ['coverage', 'Coverage'], ['reports', 'Reports'], ['governance', 'Governance']]} /><SchoolRoute activeTab={schoolTab} classrooms={classrooms} assignments={assignments} submissions={submissions} serverSummaries={serverSummaries} onAssignmentAction={assignmentAction} /></>}

      <section className="data-chain-panel" aria-label="Learning data chain">
        <div><p className="section-label">One traceable chain</p><h2>From syllabus to shared result</h2><p>Every role sees the level of detail appropriate to its responsibility.</p></div>
        <div className="data-chain">{dataChain.map((item, index) => <div className="data-chain-step" key={item.label}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.label}</strong><small>{item.detail}</small></div>)}</div>
      </section>
    </section>
  )
}

function StudentAssignments({ assignments, onStart }) {
  if (!assignments.length) return null
  return <section className="route-panel assignment-inbox"><div className="route-panel__intro"><ClipboardCheck size={22} /><div><p className="section-label">Class assignments</p><h2>Work set by your teacher</h2><p>These are bound to verified paper questions. Your score and submission event follow your IELTS-ist account across devices.</p></div></div><div className="assignment-inbox-list">{assignments.map((assignment) => <article className="assignment-row" key={assignment.id}><div><strong>{assignment.title}</strong><span>{assignment.subjectId} · {assignment.stage} · {assignment.syllabusPointId}</span><small>{assignment.sourceScope.questionIds.length} source questions</small></div><button type="button" className="primary-action compact-action" onClick={() => onStart(assignment)}><BookOpen size={15} />Start</button></article>)}</div></section>
}

function SharedAccountPanel({ account, classrooms, onRefreshAccount, onCreateClassroom, onJoinClassroom }) {
  const [className, setClassName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = account.status === 'ready'

  async function createClass() {
    if (!className.trim()) return
    setBusy(true)
    try {
      const classroom = await onCreateClassroom(className)
      setClassName('')
      setMessage(`${classroom.name} is ready. Share its class code only with invited students.`)
    } catch (error) {
      setMessage(error.message || 'The class could not be created.')
    } finally { setBusy(false) }
  }

  async function joinClass() {
    if (!inviteCode.trim()) return
    setBusy(true)
    try {
      await onJoinClassroom(inviteCode)
      setInviteCode('')
      setMessage('You have joined the class. Assigned work is now available on this account.')
    } catch (error) {
      setMessage(error.message || 'The class code could not be used.')
    } finally { setBusy(false) }
  }

  return <section className="shared-account-panel">
    <div><p className="section-label">Unified account</p><h2>{connected ? `Signed in as ${account.workspace.identity.username}` : 'Use your IELTS-ist account across both learning sites.'}</h2><p>{connected ? `${classrooms.length} class membership${classrooms.length === 1 ? '' : 's'} are stored securely for this account.` : 'Guest practice stays on this device. Sign in to join a class, receive assignments and submit cross-device results.'}</p></div>
    {connected ? <div className="shared-account-actions"><button type="button" className="secondary-action compact-action" onClick={onRefreshAccount}><Users size={16} />Refresh classes</button><label>New class<input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="e.g. Year 12 Physics" /></label><button type="button" className="primary-action compact-action" disabled={busy || !className.trim()} onClick={createClass}>Create</button><label>Class code<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Paste a code" /></label><button type="button" className="secondary-action compact-action" disabled={busy || !inviteCode.trim()} onClick={joinClass}>Join</button></div> : <a className="primary-action" href="https://ieltsist.com"><LogIn size={17} />Sign in to IELTS-ist</a>}
    {message && <p className="shared-account-message" role="status">{message}</p>}
  </section>
}

function StudentRoute({ profile, updateProfile }) {
  const track = learningTracks.find((item) => item.id === profile.learningTrack) || learningTracks[1]
  return <section className="route-panel"><div className="route-panel__intro"><BookOpen size={22} /><div><p className="section-label">Student setup</p><h2>What are you preparing for?</h2><p>Pick the route that describes your next exam. You can change it later; your history stays separate.</p></div></div><div className="track-grid">{learningTracks.map((item) => <button type="button" className={profile.learningTrack === item.id ? 'active' : ''} key={item.id} onClick={() => updateProfile({ learningTrack: item.id })}><strong>{item.label}</strong><small>{item.audience}</small><span>{item.description}</span></button>)}</div><div className="route-next"><div><strong>{track.label} route selected</strong><span>{track.description}</span></div><a className="secondary-action" href="https://ieltsist.com/?from=stem&focus=language#vocabulary" target="_blank" rel="noreferrer">{profile.learningTrack === 'IELTS' ? 'Open IELTS Vocabulary' : 'Learn STEM terms'}</a></div></section>
}

function WorkspaceSubnav({ label, items, active, onChange }) {
  return <nav className="workspace-subnav" aria-label={label}>{items.map(([id, labelText]) => <button type="button" key={id} className={active === id ? 'active' : ''} onClick={() => onChange(id)}>{labelText}</button>)}</nav>
}

function topicAverages(submissions) {
  const grouped = submissions.reduce((groups, submission) => {
    const topicId = submission.syllabusPointId || 'Unspecified topic'
    groups[topicId] = groups[topicId] || []
    groups[topicId].push(submission)
    return groups
  }, {})
  return Object.entries(grouped).map(([topicId, rows]) => ({
    topicId,
    count: rows.length,
    average: Math.round(rows.reduce((sum, row) => sum + (Number(row.percentage) || 0), 0) / rows.length),
  })).sort((left, right) => left.average - right.average)
}

function TeacherClasses({ classrooms, serverSummaries }) {
  return <section className="teacher-section" aria-label="Teacher classes"><header><div><p className="section-label">Classes</p><h2>Classroom scope and activity</h2><p>Class membership is shared through the IELTS-ist account. Only enrolled students can submit to class assignments.</p></div><Users size={24} /></header>{classrooms.length ? <div className="classroom-grid">{classrooms.map((classroom) => { const summary = serverSummaries?.[classroom.id]; return <article key={classroom.id}><strong>{classroom.name}</strong><span>{classroom.role} access</span><dl><div><dt>Students</dt><dd>{summary?.studentCount ?? 'No data'}</dd></div><div><dt>Completion</dt><dd>{summary?.assignmentCompletionRate == null ? 'No data' : `${summary.assignmentCompletionRate}%`}</dd></div><div><dt>Average</dt><dd>{summary?.averagePercentage == null ? 'No data' : `${summary.averagePercentage}%`}</dd></div></dl></article>})}</div> : <div className="role-empty"><Users size={20} /><p>No class is connected yet. Sign in, then create a class above or join with a class code.</p></div>}</section>
}

function TeacherInsights({ submissions }) {
  const topics = topicAverages(submissions)
  return <section className="teacher-section" aria-label="Teacher insights"><header><div><p className="section-label">Insights</p><h2>Find the next reteach topic</h2><p>Topic averages use submitted, source-bound work only. They are not official grades.</p></div><BarChart3 size={24} /></header>{topics.length ? <div className="insight-table">{topics.map((topic) => <div key={topic.topicId}><div><strong>{topic.topicId}</strong><span>{topic.count} submitted set{topic.count === 1 ? '' : 's'}</span></div><b>{topic.average}%</b><i style={{ width: `${topic.average}%` }} /></div>)}</div> : <div className="role-empty"><BarChart3 size={20} /><p>Insights appear after students submit class assignments. This view never uses unfinished drafts or notebook pages.</p></div>}</section>
}

function TeacherReview({ submissions, assignments, onAssignmentAction }) {
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [status, setStatus] = useState('')
  const selected = submissions.find((item) => item.id === selectedSubmissionId) || submissions[0]

  async function sendFeedback() {
    if (!selected || !feedback.trim()) return
    setStatus('')
    try {
      await onAssignmentAction(`/api/stem/assignments/${encodeURIComponent(selected.assignmentId)}/feedback`, {
        method: 'POST', body: JSON.stringify({ studentUserId: selected.studentUserId, body: feedback }),
      })
      setFeedback('')
      setStatus('Feedback is available to this student in their assignment context.')
    } catch (error) { setStatus(error.message || 'Feedback could not be sent.') }
  }

  return <section className="teacher-section" aria-label="Teacher review"><header><div><p className="section-label">Review</p><h2>Respond to submitted work</h2><p>Use the score and source-bound result to guide next steps. Private notebook pages, handwriting and Coach chats are never loaded here.</p></div><ClipboardCheck size={24} /></header>{submissions.length ? <><div className="teacher-table-scroll"><table><thead><tr><th>Student</th><th>Topic</th><th>Result</th><th>Marking source</th><th>Submitted</th></tr></thead><tbody>{submissions.slice(0, 30).map((submission) => <tr key={submission.id}><td><button type="button" className="text-action" onClick={() => setSelectedSubmissionId(submission.id)}>{submission.studentUserId.replace(/^.*:/, 'Student ')}</button></td><td>{submission.syllabusPointId}</td><td>{submission.rawMarks}/{submission.maxMarks} ({submission.percentage}%)</td><td>{submission.markingMode === 'official' ? 'Official mark points' : submission.markingMode === 'assisted' ? 'AI-assisted review' : 'Verified scoring'}</td><td>{new Date(submission.occurredAt).toLocaleDateString('en-GB')}</td></tr>)}</tbody></table></div><div className="permission-note"><strong>Feedback for {selected?.studentUserId.replace(/^.*:/, 'Student ')}</strong><span>{assignments.find((assignment) => assignment.id === selected?.assignmentId)?.title || selected?.syllabusPointId}</span><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Give a concise next step based on the submitted result." rows="3" /><button type="button" className="primary-action compact-action" disabled={!feedback.trim()} onClick={sendFeedback}><MessageSquareText size={16} />Send feedback</button>{status && <p className="shared-account-message" role="status">{status}</p>}</div></> : <div className="role-empty"><ClipboardCheck size={20} /><p>No submitted assignment evidence yet. Students retain their private notebook and Coach conversations.</p></div>}</section>
}

function TeacherContent() {
  const contentSubjects = subjects.filter((subject) => !['bpho', 'esat', 'tmua', 'amc12'].includes(subject.id))
  return <section className="teacher-section" aria-label="Teacher content"><header><div><p className="section-label">Content</p><h2>Verified source availability</h2><p>Every item keeps separate question-paper and mark-scheme provenance. A smaller indexed bank remains usable and is marked clearly.</p></div><Layers3 size={24} /></header><div className="content-inventory">{contentSubjects.map((subject) => <div key={subject.id}><span style={{ color: subject.accent }}>{subject.code}</span><strong>{subject.name}</strong><small>{questionInventory({ subjectId: subject.id })} verified question items</small></div>)}</div></section>
}

function TeacherHome({ assignments, submissions, serverSummaries, learningProgress }) {
  const submittedAssignmentIds = new Set(submissions.map((submission) => submission.assignmentId))
  const completionRate = assignments.length ? Math.round((submittedAssignmentIds.size / assignments.length) * 100) : null
  const average = submissions.length ? Math.round(submissions.reduce((sum, submission) => sum + (Number(submission.percentage) || 0), 0) / submissions.length) : null
  const topicRows = Object.entries(Object.groupBy(submissions, (submission) => submission.syllabusPointId)).map(([topicId, rows]) => ({ topicId, count: rows.length, average: Math.round(rows.reduce((sum, row) => sum + (Number(row.percentage) || 0), 0) / rows.length) })).sort((left, right) => left.average - right.average)
  const classSupport = Object.entries(serverSummaries || {}).flatMap(([classroomId, summary]) => summary?.needsSupport ? [{ classroomId, count: summary.needsSupport, average: summary.averagePercentage }] : [])
  return <section className="teacher-home" aria-label="Teacher Home"><div className="teacher-home-heading"><div><p className="section-label">Teacher Home</p><h2>Act on the next teaching signal</h2><p>Scores are aggregate evidence from verified QP/MS practice. Private notebooks and Coach chats remain outside this view.</p></div><span>{learningProgress?.completedSets || 0} local submitted sets</span></div><div className="teacher-metric-grid"><div><span>Active assignments</span><strong>{assignments.length}</strong><small>{assignments.filter((assignment) => assignment.status === 'active').length} open</small></div><div><span>Assignment completion</span><strong>{completionRate == null ? 'No data' : `${completionRate}%`}</strong><small>{submissions.length} server submissions</small></div><div><span>Average correctness</span><strong>{average == null ? 'No data' : `${average}%`}</strong><small>Submitted work only</small></div><div><span>Support queue</span><strong>{classSupport.reduce((sum, item) => sum + item.count, 0)}</strong><small>Below 60% in class summary</small></div></div><div className="teacher-home-grid"><section className="teacher-table-panel"><header><div><p className="section-label">Review</p><h3>Recent submissions</h3></div><span>Teacher-visible metadata only</span></header>{submissions.length ? <div className="teacher-table-scroll"><table><thead><tr><th>Student</th><th>Topic</th><th>Score</th><th>Submitted</th></tr></thead><tbody>{submissions.slice(0, 8).map((submission) => <tr key={submission.id}><td>{submission.studentUserId.replace(/^.*:/, 'Student ')}</td><td>{submission.syllabusPointId}</td><td>{submission.rawMarks}/{submission.maxMarks} ({submission.percentage}%)</td><td>{new Date(submission.occurredAt).toLocaleDateString('en-GB')}</td></tr>)}</tbody></table></div> : <div className="role-empty"><ClipboardCheck size={20} /><p>Published assignments and student submissions will appear here. Start with a three-step verified assignment below.</p></div>}</section><section className="teacher-table-panel"><header><div><p className="section-label">Insights</p><h3>Topics needing attention</h3></div><span>Lowest submitted average first</span></header>{topicRows.length ? <div className="topic-insight-list">{topicRows.slice(0, 5).map((topic) => <div key={topic.topicId}><strong>{topic.topicId}</strong><span>{topic.count} submission{topic.count === 1 ? '' : 's'} · {topic.average}% average</span><i style={{ width: `${topic.average}%` }} /></div>)}</div> : <div className="role-empty"><BarChart3 size={20} /><p>Topic insight appears after students submit a verified assignment.</p></div>}</section></div></section>
}

function TeacherRoute({ assignments, assignmentDraft, setAssignmentDraft, selectedSubject, topics, changeSubject, chooseClassroom, teacherClasses, copyAssignment, copiedId, onCreateAssignment, account, onAssignmentAction }) {
  const stages = stagesForSubject(selectedSubject.code)
  const indexedCount = questionInventory({ subjectId: assignmentDraft.subjectId, stage: assignmentDraft.stage, knowledgeGroupId: assignmentDraft.topicId })
  const [error, setError] = useState('')
  async function createAssignment() {
    try { setError(''); await onCreateAssignment(assignmentDraft) } catch (reason) { setError(reason.message || 'The assignment could not be created.') }
  }
  async function updateAssignment(assignment, patch) {
    try {
      setError('')
      await onAssignmentAction(`/api/stem/assignments/${encodeURIComponent(assignment.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } catch (reason) { setError(reason.message || 'The assignment could not be updated.') }
  }
  async function sendReminder(assignment) {
    try {
      setError('')
      const result = await onAssignmentAction(`/api/stem/assignments/${encodeURIComponent(assignment.id)}/reminders`, { method: 'POST', body: JSON.stringify({ audience: 'incomplete' }) })
      setError(`Reminder recorded for ${result.reminder.audienceCount} enrolled student${result.reminder.audienceCount === 1 ? '' : 's'}.`)
    } catch (reason) { setError(reason.message || 'The reminder could not be recorded.') }
  }
  return <div className="role-grid"><section className="role-panel"><header><div><p className="section-label">Assignments</p><h2>Publish verified work in three steps</h2><p>Choose the course and topic, set a due date, then publish to one permissioned class.</p></div><ClipboardCheck size={26} /></header>{account.status !== 'ready' ? <div className="role-empty"><ShieldCheck size={20} /><p>Sign in with IELTS-ist first. A browser role selection never grants teacher access.</p></div> : <><label>1. Course<select value={assignmentDraft.subjectId} onChange={(event) => changeSubject(event.target.value)}>{subjects.filter((subject) => !['bpho', 'esat', 'tmua', 'amc12'].includes(subject.id)).map((subject) => <option value={subject.id} key={subject.id}>{subject.code} {subject.name}</option>)}</select></label><label>1. Stage and syllabus topic<select value={assignmentDraft.stage} onChange={(event) => setAssignmentDraft((current) => ({ ...current, stage: event.target.value }))}>{stages.map((stage) => <option value={stage} key={stage}>{stage}</option>)}</select><select value={assignmentDraft.topicId} onChange={(event) => setAssignmentDraft((current) => ({ ...current, topicId: event.target.value }))}>{topics.length ? topics.map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>) : <option value="">No source indexed yet</option>}</select></label><div className="assignment-preflight"><strong>{indexedCount} verified source questions</strong><span>Each selected item keeps its paired question paper and mark scheme. A standard assignment uses 10 questions when available.</span></div><label>2. Assignment name<input value={assignmentDraft.title} onChange={(event) => setAssignmentDraft((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Electricity: method marks" /></label><label>2. Due date<input type="date" value={assignmentDraft.dueDate} onChange={(event) => setAssignmentDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label><label>3. Class<select value={assignmentDraft.classroomId} onChange={(event) => chooseClassroom(event.target.value)}><option value="">Choose a class</option>{teacherClasses.map((classroom) => <option value={classroom.id} key={classroom.id}>{classroom.name}</option>)}</select></label><button type="button" className="primary-action" onClick={createAssignment} disabled={!assignmentDraft.topicId || !assignmentDraft.classroomId || indexedCount < 1}><Link2 size={17} />Publish assignment</button>{error && <p className="form-error">{error}</p>}</>}</section><section className="role-panel"><header><div><p className="section-label">Assignment lifecycle</p><h2>{assignments.length ? `${assignments.length} class task${assignments.length === 1 ? '' : 's'}` : 'No assignments yet'}</h2></div><Users size={26} /></header>{assignments.length ? assignments.map((assignment) => <article className="assignment-row" key={assignment.id}><div><strong>{assignment.title}</strong><span>{assignment.subjectId} · {assignment.stage} · {assignment.syllabusPointId}</span><small>{assignment.sourceScope.questionIds.length} verified QP/MS-bound questions · {assignment.status} · {assignment.reminderCount || 0} reminders recorded</small></div><div className="assignment-row__actions"><select aria-label={`Update ${assignment.title} status`} value={assignment.status} onChange={(event) => updateAssignment(assignment, { status: event.target.value })}><option value="draft">Draft</option><option value="active">Published</option><option value="closed">Closed</option><option value="archived">Archived</option></select>{assignment.status === 'active' && <button type="button" className="secondary-action compact-action" onClick={() => sendReminder(assignment)}><BellRing size={15} />Remind</button>}<button type="button" className="secondary-action compact-action" onClick={() => copyAssignment(assignment)}><Copy size={15} />{copiedId === assignment.id ? 'Copied' : 'Copy ID'}</button></div></article>) : <div className="role-empty"><ShieldCheck size={20} /><p>Publish a verified question set to create a visible student task. Source status stays clear even while more papers are indexed.</p></div>}<div className="permission-note"><strong>Teacher can see</strong><span>completion, marks, time, hint level, mistake tags and AI review confidence.</span><strong>Teacher cannot see</strong><span>students outside this class or private notes they have not shared.</span></div></section></div>
}

function SchoolCohorts({ classrooms, serverSummaries }) {
  return <section className="teacher-section" aria-label="School cohorts"><header><div><p className="section-label">Cohorts</p><h2>Compare class-level trends</h2><p>Each row is aggregated by class. Student notebooks, drafts and AI conversations are not part of this report.</p></div><Users size={24} /></header>{classrooms.length ? <div className="teacher-table-scroll"><table><thead><tr><th>Class</th><th>Enrolled</th><th>Active · 28 days</th><th>Completion</th><th>Average</th></tr></thead><tbody>{classrooms.map((classroom) => { const summary = serverSummaries?.[classroom.id]; return <tr key={classroom.id}><td>{classroom.name}</td><td>{summary?.studentCount ?? 'No data'}</td><td>{summary?.activeStudentCount ?? 'No data'}</td><td>{summary?.assignmentCompletionRate == null ? 'No data' : `${summary.assignmentCompletionRate}%`}</td><td>{summary?.averagePercentage == null ? 'No data' : `${summary.averagePercentage}%`}</td></tr> })}</tbody></table></div> : <div className="role-empty"><Users size={20} /><p>No permissioned classes are available. School reports appear once classes and memberships are connected.</p></div>}</section>
}

function SchoolHealth({ submissions }) {
  const risks = topicAverages(submissions).filter((topic) => topic.average < 60)
  return <section className="teacher-section" aria-label="Programme health"><header><div><p className="section-label">Programme Health</p><h2>Support signals, not rankings</h2><p>Topics under 60% are shown with the size of the submitted evidence. Use them to plan a targeted assignment or reteach group.</p></div><BarChart3 size={24} /></header>{risks.length ? <div className="insight-table">{risks.map((topic) => <div key={topic.topicId}><div><strong>{topic.topicId}</strong><span>{topic.count} submitted set{topic.count === 1 ? '' : 's'}</span></div><b>{topic.average}%</b><i style={{ width: `${topic.average}%` }} /></div>)}</div> : <div className="role-empty"><BarChart3 size={20} /><p>No programme-level risk signal is available yet. This is expected before permissioned submissions arrive.</p></div>}</section>
}

function SchoolCoverage({ assignments, serverSummaries }) {
  const knownTopics = learningPlan.knowledgeGroups.filter((group) => !group.hidden)
  const activeTopics = new Set([...assignments.map((assignment) => assignment.syllabusPointId), ...Object.values(serverSummaries || {}).flatMap((summary) => Object.keys(summary.coverageBySyllabusPoint || {}))])
  const bySubject = learningPlan.subjects.map((subject) => {
    const points = subject.knowledgeGroupIds.filter((id) => knownTopics.some((topic) => topic.id === id))
    const covered = points.filter((id) => activeTopics.has(id)).length
    return { subject, points: points.length, covered }
  }).filter((item) => item.points)
  return <section className="teacher-section" aria-label="Curriculum coverage"><header><div><p className="section-label">Curriculum Coverage</p><h2>Where verified activity exists</h2><p>Coverage means a syllabus topic has an assigned or submitted verified question set. It does not imply the topic has been mastered.</p></div><Layers3 size={24} /></header><div className="coverage-grid">{bySubject.map((item) => <div key={item.subject.id}><strong>{item.subject.code} {item.subject.name}</strong><span>{item.covered}/{item.points} syllabus topics with activity</span><i><b style={{ width: `${Math.round((item.covered / item.points) * 100)}%` }} /></i></div>)}</div></section>
}

function SchoolReports({ classrooms, assignments, serverSummaries }) {
  function downloadReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      scope: 'Permissioned aggregate classes only',
      classes: classrooms.map((classroom) => ({ name: classroom.name, ...(serverSummaries?.[classroom.id] || {}) })),
      assignments: assignments.length,
      privacy: 'No student notes, drafts, handwriting images, or AI conversations included.',
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `stem-programme-report-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return <section className="teacher-section" aria-label="School reports"><header><div><p className="section-label">Reports</p><h2>Export a privacy-safe programme snapshot</h2><p>The export includes scope, timestamp, aggregate class metrics, curriculum coverage evidence and assignment count. It excludes student-level records by default.</p></div><FileText size={24} /></header><button type="button" className="primary-action" onClick={downloadReport}><Download size={17} />Download aggregate report</button></section>
}

function SchoolGovernance() {
  return <section className="teacher-section" aria-label="School governance"><header><div><p className="section-label">Governance</p><h2>Data boundaries and permissions</h2><p>Shared authentication comes from IELTS-ist. Class membership and role checks determine which STEM records a person may access.</p></div><ShieldCheck size={24} /></header><div className="governance-grid"><div><strong>Student</strong><span>Own attempts, private notebook, handwriting and Coach conversation.</span></div><div><strong>Teacher</strong><span>Permissioned class submissions and aggregate topic signals, never unrelated students.</span></div><div><strong>School</strong><span>Aggregate programme data by default. Student-level detail requires explicit policy and auditable authorization.</span></div><div><strong>Sources</strong><span>Question-paper and mark-scheme provenance remains attached to every verified assignment.</span></div></div></section>
}

function rangeWindow(range) {
  if (range === 'all') return {}
  const days = range === 'week' ? 7 : range === 'term' ? 90 : range === 'year' ? 365 : 30
  return { from: new Date(Date.now() - days * 86_400_000).toISOString(), to: new Date().toISOString() }
}

function SchoolAnalyticsRoute({ activeTab, onAssignmentAction }) {
  const [range, setRange] = useState('month')
  const [analytics, setAnalytics] = useState(null)
  const [state, setState] = useState('')
  const window = useMemo(() => rangeWindow(range), [range])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window).toString()
    onAssignmentAction(`/api/stem/school/analytics${params ? `?${params}` : ''}`, { method: 'GET' })
      .then((result) => { if (!cancelled) { setAnalytics(result.analytics); setState('') } })
      .catch((error) => { if (!cancelled) setState(error.message || 'School data could not be refreshed.') })
    return () => { cancelled = true }
  }, [onAssignmentAction, range, window])

  async function exportAnonymousReport() {
    try {
      const params = new URLSearchParams(window).toString()
      const result = await onAssignmentAction(`/api/stem/school/reports/anonymous${params ? `?${params}` : ''}`, { method: 'GET' })
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.report, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `stem-anonymous-programme-report-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setState('Anonymous report downloaded. It contains no student identifiers or private learning artefacts.')
    } catch (error) { setState(error.message || 'The anonymous report could not be generated.') }
  }

  if (!analytics) {
    return <section className="teacher-section" aria-label="School reporting controls"><header><div><p className="section-label">School reporting</p><h2>Loading aggregate programme data</h2><p>Programme data is aggregated on the server. Private notes, handwriting, drafts and Coach conversations are excluded.</p></div><School size={24} /></header><label>Time range<select value={range} onChange={(event) => setRange(event.target.value)}><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="term">This term</option><option value="year">Last 12 months</option><option value="all">All recorded time</option></select></label>{state && <p className="shared-account-message" role="status">{state}</p>}</section>
  }

  const cohorts = analytics.cohorts || []
  const topicCoverage = analytics.topicCoverage || []
  const riskReasons = analytics.riskReasons || []
  const totals = cohorts.reduce((result, cohort) => ({
    students: result.students + (cohort.summary.studentCount || 0),
    activeStudents: result.activeStudents + (cohort.summary.activeStudentCount || 0),
    submissions: result.submissions + (cohort.summary.submissions || 0),
    weightedAverage: result.weightedAverage + ((cohort.summary.averagePercentage || 0) * (cohort.summary.submissions || 0)),
  }), { students: 0, activeStudents: 0, submissions: 0, weightedAverage: 0 })
  const average = totals.submissions ? Math.round(totals.weightedAverage / totals.submissions) : null
  const controls = <section className="teacher-section" aria-label="School reporting controls"><header><div><p className="section-label">School reporting</p><h2>Programme signals for a defined period</h2><p>{analytics.privacy}</p></div><School size={24} /></header><label>Time range<select value={range} onChange={(event) => setRange(event.target.value)}><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="term">This term</option><option value="year">Last 12 months</option><option value="all">All recorded time</option></select></label>{state && <p className="shared-account-message" role="status">{state}</p>}</section>

  if (activeTab === 'reports') return <>{controls}<section className="teacher-section" aria-label="Anonymous school report"><header><div><p className="section-label">Anonymous report</p><h2>Export a privacy-safe programme snapshot</h2><p>The downloaded report replaces class names with cohort labels and excludes student identifiers, notes, handwriting and AI conversations.</p></div><FileText size={24} /></header><button type="button" className="primary-action" onClick={exportAnonymousReport}><Download size={17} />Download anonymous report</button></section></>
  if (activeTab === 'cohorts') return <>{controls}<section className="teacher-section" aria-label="School cohorts"><header><div><p className="section-label">Cohorts</p><h2>Compare class-level trends</h2><p>Each row is a permissioned, aggregate class summary.</p></div><Users size={24} /></header><div className="teacher-table-scroll"><table><thead><tr><th>Class</th><th>Enrolled</th><th>Active</th><th>Completion</th><th>Average</th><th>Risk reason</th></tr></thead><tbody>{cohorts.map((cohort) => <tr key={cohort.classroomId}><td>{cohort.name}</td><td>{cohort.summary.studentCount}</td><td>{cohort.summary.activeStudentCount}</td><td>{cohort.summary.assignmentCompletionRate == null ? 'No data' : `${cohort.summary.assignmentCompletionRate}%`}</td><td>{cohort.summary.averagePercentage == null ? 'No data' : `${cohort.summary.averagePercentage}%`}</td><td>{cohort.summary.riskReasons.length ? cohort.summary.riskReasons.join('; ') : 'No current signal'}</td></tr>)}</tbody></table></div></section></>
  if (activeTab === 'health') return <>{controls}<section className="teacher-section" aria-label="Programme health"><header><div><p className="section-label">Programme Health</p><h2>Reasons behind intervention signals</h2><p>Signals require submitted, source-bound evidence and are not rankings.</p></div><BarChart3 size={24} /></header>{riskReasons.length ? <div className="insight-table">{riskReasons.map((risk) => <div key={risk.reason}><div><strong>{risk.reason}</strong><span>{risk.cohortsAffected} cohort{risk.cohortsAffected === 1 ? '' : 's'} affected</span></div><b>{risk.cohortsAffected}</b></div>)}</div> : <div className="role-empty"><BarChart3 size={20} /><p>No programme risk reason is visible in this period.</p></div>}</section></>
  if (activeTab === 'coverage') return <>{controls}<section className="teacher-section" aria-label="Curriculum coverage"><header><div><p className="section-label">Curriculum Coverage</p><h2>Verified activity by syllabus topic</h2><p>Coverage means a syllabus-linked assignment has submitted evidence. It is not a mastery claim.</p></div><Layers3 size={24} /></header>{topicCoverage.length ? <div className="insight-table">{topicCoverage.map((topic) => <div key={topic.topicId}><div><strong>{topic.topicId}</strong><span>{topic.submissions} submitted set{topic.submissions === 1 ? '' : 's'}</span></div><b>{topic.averagePercentage == null ? 'No score' : `${topic.averagePercentage}%`}</b><i style={{ width: `${topic.averagePercentage || 0}%` }} /></div>)}</div> : <div className="role-empty"><Layers3 size={20} /><p>No syllabus-linked submission is available in this reporting period.</p></div>}</section></>
  if (activeTab === 'governance') return <><>{controls}</><SchoolGovernance /></>
  return <><>{controls}</><div className="school-route"><div className="school-summary"><div><Users size={24} /><span>Active students</span><strong>{totals.activeStudents}<small>{totals.students} enrolled students</small></strong></div><div><ClipboardCheck size={24} /><span>Submitted sets</span><strong>{totals.submissions}<small>Source-bound work in this window</small></strong></div><div><BarChart3 size={24} /><span>Average result</span><strong>{average == null ? 'No data' : `${average}%`}<small>Aggregate submitted evidence</small></strong></div><div><School size={24} /><span>Topics with activity</span><strong>{topicCoverage.length}<small>{analytics.cohortCount} permissioned cohorts</small></strong></div></div><section className="role-panel school-panel"><header><div><p className="section-label">Programme Health</p><h2>What leaders need to decide</h2></div><ShieldCheck size={24} /></header><div className="school-decisions"><div><strong>Coverage</strong><span>{topicCoverage.length ? `${topicCoverage.length} syllabus topics have submitted evidence in this period.` : 'No syllabus topic has submitted evidence in this period.'}</span></div><div><strong>Risk</strong><span>{riskReasons.length ? riskReasons.map((risk) => `${risk.reason} (${risk.cohortsAffected})`).join(' · ') : 'No current aggregate risk reason.'}</span></div><div><strong>Action</strong><span>{riskReasons.length ? 'Review the lowest coverage topic with the relevant teacher and publish a targeted verified set.' : 'Maintain current activity and review coverage before the next reporting period.'}</span></div></div><p className="data-boundary"><ShieldCheck size={16} /> {analytics.privacy}</p></section></div></>
}

function SchoolRoute(props) {
  // Keep the legacy helpers available for backwards-compatible embedded snapshots.
  void SchoolCohorts
  void SchoolHealth
  void SchoolCoverage
  void SchoolReports
  return <SchoolAnalyticsRoute {...props} />
}
