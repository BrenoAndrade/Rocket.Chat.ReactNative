import { Alert } from 'react-native';
import { put, call, takeLatest, take, select, race, fork, cancel, takeEvery } from 'redux-saga/effects';
import { delay } from 'redux-saga';
import { BACKGROUND } from 'redux-enhancer-react-native-appstate';

import * as types from '../actions/actionsTypes';
// import { roomsSuccess, roomsFailure } from '../actions/rooms';
import { addUserTyping, removeUserTyping, setLastOpen } from '../actions/room';
import { messagesRequest, editCancel } from '../actions/messages';
import RocketChat from '../lib/rocketchat';
import database from '../lib/realm';
import log from '../utils/log';
import { NavigationActions } from '../Navigation';

const leaveRoom = rid => RocketChat.leaveRoom(rid);
const eraseRoom = rid => RocketChat.eraseRoom(rid);

let sub;
let thread;

// const getRooms = function* getRooms() {
// 	return yield RocketChat.getRooms();
// };

// const watchRoomsRequest = function* watchRoomsRequest() {
// 	try {
// 		yield call(getRooms);
// 		yield put(roomsSuccess());
// 	} catch (err) {
// 		yield put(roomsFailure(err.status));
// 	}
// };

const cancelTyping = function* cancelTyping(username) {
	while (true) {
		const { typing, timeout } = yield race({
			typing: take(types.ROOM.SOMEONE_TYPING),
			timeout: call(delay, 5000)
		});
		if (timeout || (typing.username === username && !typing.typing)) {
			return yield put(removeUserTyping(username));
		}
	}
};

const usersTyping = function* usersTyping({ rid }) {
	while (true) {
		const { _rid, username, typing } = yield take(types.ROOM.SOMEONE_TYPING);
		if (_rid === rid) {
			yield (typing ? put(addUserTyping(username)) : put(removeUserTyping(username)));
			if (typing) {
				yield fork(cancelTyping, username);
			}
		}
	}
};
const handleMessageReceived = function* handleMessageReceived({ message }) {
	try {
		const room = yield select(state => state.room);

		if (message.rid === room.rid) {
			database.write(() => {
				database.create('messages', message, true);
			});

			RocketChat.readMessages(room.rid);
		}
	} catch (e) {
		console.warn('handleMessageReceived', e);
	}
};

const watchRoomOpen = function* watchRoomOpen({ room }) {
	try {
		yield put(messagesRequest({ ...room }));
		// const { open } = yield race({
		// 	messages: take(types.MESSAGES.SUCCESS),
		// 	open: take(types.ROOM.OPEN)
		// });
		//
		// if (open) {
		// 	return;
		// }

		RocketChat.readMessages(room.rid);
		sub = yield RocketChat.subscribeRoom(room);
		// const subscriptions = yield Promise.all([RocketChat.subscribe('stream-room-messages', room.rid, false), RocketChat.subscribe('stream-notify-room', `${ room.rid }/typing`, false)]);
		thread = yield fork(usersTyping, { rid: room.rid });
		yield race({
			open: take(types.ROOM.OPEN),
			close: take(types.ROOM.CLOSE)
		});
		cancel(thread);
		sub.stop();
		yield put(editCancel());

		// subscriptions.forEach((sub) => {
		// 	sub.unsubscribe().catch(e => alert(e));
		// });
	} catch (e) {
		log('watchRoomOpen', e);
	}
};

const watchuserTyping = function* watchuserTyping({ status }) {
	const auth = yield select(state => state.login.isAuthenticated);
	if (!auth) {
		yield take(types.LOGIN.SUCCESS);
	}

	const room = yield select(state => state.room);

	if (!room) {
		return;
	}

	try {
		yield RocketChat.emitTyping(room.rid, status);

		if (status) {
			yield call(delay, 5000);
			yield RocketChat.emitTyping(room.rid, false);
		}
	} catch (e) {
		log('watchuserTyping', e);
	}
};

// const updateRoom = function* updateRoom() {
// 	const room = yield select(state => state.room);
// 	if (!room || !room.rid) {
// 		return;
// 	}
// 	yield put(messagesRequest({ rid: room.rid }));
// };

const updateLastOpen = function* updateLastOpen() {
	yield put(setLastOpen());
};

const goRoomsListAndDelete = function* goRoomsListAndDelete(rid) {
	NavigationActions.popToRoot();
	yield delay(1000);
	try {
		database.write(() => {
			const messages = database.objects('messages').filtered('rid = $0', rid);
			database.delete(messages);
			const subscription = database.objects('subscriptions').filtered('rid = $0', rid);
			database.delete(subscription);
		});
	} catch (error) {
		console.warn('goRoomsListAndDelete', error);
	}
};

const handleLeaveRoom = function* handleLeaveRoom({ rid }) {
	try {
		sub.stop();
		yield call(leaveRoom, rid);
		yield goRoomsListAndDelete(rid);
	} catch (e) {
		if (e.error === 'error-you-are-last-owner') {
			Alert.alert('You are the last owner. Please set new owner before leaving the room.');
		} else {
			Alert.alert('Something happened when leaving room!');
		}
	}
};

const handleEraseRoom = function* handleEraseRoom({ rid }) {
	try {
		sub.stop();
		yield call(eraseRoom, rid);
		yield goRoomsListAndDelete(rid);
	} catch (e) {
		Alert.alert('Something happened when erasing room!');
	}
};

const root = function* root() {
	yield takeLatest(types.ROOM.USER_TYPING, watchuserTyping);
	yield takeLatest(types.ROOM.OPEN, watchRoomOpen);
	yield takeEvery(types.ROOM.MESSAGE_RECEIVED, handleMessageReceived);
	// yield takeLatest(FOREGROUND, updateRoom);
	// yield takeLatest(FOREGROUND, watchRoomsRequest);
	yield takeLatest(BACKGROUND, updateLastOpen);
	yield takeLatest(types.ROOM.LEAVE, handleLeaveRoom);
	yield takeLatest(types.ROOM.ERASE, handleEraseRoom);
};
export default root;
