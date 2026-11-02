# Smart Factory Resource Allocation System (SRAS)
## College Project Documentation & Technical Report

For the full, detailed technical documentation, please refer to the project root:
- [`COLLEGE_DOCUMENTATION.md`](../COLLEGE_DOCUMENTATION.md)
- [`README.md`](../README.md)
- [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md)

### Key Project Highlights:
1. **Intelligent Multi-Constraint Matching Engine**:
   - Matches employee skills with required task certifications.
   - Matches machine equipment type and material category compatibility.
   - Enforces inventory availability with protected safety reorder buffers.
2. **Temporal Overlap Prevention**:
   - Strictly eliminates double-booking of technicians or machines for intersecting time windows.
3. **Multi-Objective Workload Balancing**:
   - Minimizes worker fatigue by choosing the qualified technician with the lowest workload percentage below max threshold (85%).
4. **ACID Transaction Security**:
   - Commits task, allocation, and inventory reservations atomically using Firestore `runTransaction` to prevent race conditions.
5. **Least-Privilege Security Rules**:
   - Firestore security rules prevent standard users from self-escalating to `admin`.
