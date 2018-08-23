import React from 'react';
import PropTypes from 'prop-types';
import { View, StyleSheet, SafeAreaView, FlatList, LayoutAnimation, Platform, ScrollView } from 'react-native';
import { connect } from 'react-redux';

import { addUser, removeUser, reset, setLoading } from '../actions/selectedUsers';
import database from '../lib/realm';
import RocketChat from '../lib/rocketchat';
import UserItem from '../presentation/UserItem';
import Loading from '../containers/Loading';
import debounce from '../utils/debounce';
import LoggedView from './View';
import I18n from '../i18n';
import log from '../utils/log';
import SearchBox from '../containers/SearchBox';

const styles = StyleSheet.create({
	safeAreaView: {
		flex: 1,
		backgroundColor: Platform.OS === 'ios' ? '#F7F8FA' : '#E1E5E8'
	},
	list: {
		width: '100%',
		backgroundColor: '#FFFFFF'
	},
	separator: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: '#E1E5E8',
		marginLeft: 60
	},
	borderVertical: {
		borderTopWidth: StyleSheet.hairlineWidth,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderColor: '#CBCED1'
	}
});

@connect(state => ({
	users: state.selectedUsers.users,
	loading: state.selectedUsers.loading
}), dispatch => ({
	addUser: user => dispatch(addUser(user)),
	removeUser: user => dispatch(removeUser(user)),
	reset: () => dispatch(reset()),
	setLoadingInvite: loading => dispatch(setLoading(loading))
}))
/** @extends React.Component */
export default class SelectedUsersView extends LoggedView {
	static propTypes = {
		navigator: PropTypes.object,
		rid: PropTypes.string,
		nextAction: PropTypes.string.isRequired,
		addUser: PropTypes.func.isRequired,
		removeUser: PropTypes.func.isRequired,
		reset: PropTypes.func.isRequired,
		users: PropTypes.array,
		loading: PropTypes.bool,
		setLoadingInvite: PropTypes.func
	};

	constructor(props) {
		super('SelectedUsersView', props);
		this.data = database.objects('subscriptions').filtered('t = $0', 'd').sorted('roomUpdatedAt', true);
		this.state = {
			search: []
		};
		this.data.addListener(this.updateState);
		props.navigator.setOnNavigatorEvent(this.onNavigatorEvent.bind(this));
	}

	componentDidMount() {
		this.props.navigator.setDrawerEnabled({
			side: 'left',
			enabled: false
		});
	}

	componentWillReceiveProps(nextProps) {
		if (nextProps.users.length !== this.props.users.length) {
			const { length } = nextProps.users;
			const rightButtons = [];
			if (length > 0) {
				const next = {
					id: 'create',
					title: 'Next',
					testID: 'selected-users-view-submit'
				};
				rightButtons.push(next);
			}
			this.props.navigator.setButtons({ rightButtons });
		}
	}

	componentWillUnmount() {
		this.updateState.stop();
		this.data.removeAllListeners();
		this.props.reset();
	}

	async onNavigatorEvent(event) {
		if (event.type === 'NavBarButtonPress') {
			if (event.id === 'create') {
				const { nextAction, setLoadingInvite, navigator } = this.props;
				if (nextAction === 'CREATE_CHANNEL') {
					this.props.navigator.push({
						screen: 'CreateChannelView',
						title: I18n.t('Create_Channel'),
						backButtonTitle: ''
					});
				} else {
					try {
						setLoadingInvite(true);
						await RocketChat.addUsersToRoom(this.props.rid);
						navigator.pop();
					} catch (e) {
						log('RoomActions Add User', e);
					} finally {
						setLoadingInvite(false);
					}
				}
			}
		}
	}

	onSearchChangeText(text) {
		this.search(text);
	}

	updateState = debounce(() => {
		this.forceUpdate();
	}, 1000);

	async search(text) {
		const searchText = text.trim();
		if (searchText === '') {
			delete this.oldPromise;
			return this.setState({
				search: []
			});
		}

		let data = this.data.filtered('name CONTAINS[c] $0 AND t = $1', searchText, 'd').slice(0, 7);

		const usernames = data.map(sub => sub.map);
		try {
			if (data.length < 7) {
				if (this.oldPromise) {
					this.oldPromise('cancel');
				}

				const { users } = await Promise.race([
					RocketChat.spotlight(searchText, usernames, { users: true, rooms: false }),
					new Promise((resolve, reject) => this.oldPromise = reject)
				]);

				data = users.map(user => ({
					...user,
					rid: user.username,
					name: user.username,
					t: 'd',
					search: true
				}));

				delete this.oldPromise;
			}
			this.setState({
				search: data
			});
		} catch (e) {
			// alert(JSON.stringify(e));
		}
	}

	isChecked = username => this.props.users.findIndex(el => el.name === username) !== -1;

	toggleUser = (user) => {
		LayoutAnimation.easeInEaseOut();
		if (!this.isChecked(user.name)) {
			this.props.addUser(user);
		} else {
			this.props.removeUser(user);
		}
	}

	_onPressItem = (id, item = {}) => {
		if (item.search) {
			this.toggleUser({ _id: item._id, name: item.username, fname: item.name });
		} else {
			this.toggleUser({ _id: item._id, name: item.name, fname: item.fname });
		}
	}

	_onPressSelectedItem = item => this.toggleUser(item);

	renderHeader = () => (
		<View>
			<SearchBox onChangeText={text => this.onSearchChangeText(text)} />
			{this.renderSelected()}
		</View>
	)

	renderSelected = () => {
		if (this.props.users.length === 0) {
			return null;
		}
		return (
			<FlatList
				data={this.props.users}
				keyExtractor={item => item._id}
				style={[styles.list, styles.borderVertical]}
				contentContainerStyle={{ marginVertical: 5 }}
				renderItem={this.renderSelectedItem}
				enableEmptySections
				keyboardShouldPersistTaps='always'
				horizontal
			/>
		);
	}

	renderSelectedItem = ({ item }) => (
		<UserItem
			name={item.fname}
			username={item.name}
			onPress={() => this._onPressSelectedItem(item)}
			testID={`selected-user-${ item.name }`}
			style={{ paddingRight: 15 }}
		/>
	)

	renderSeparator = () => <View style={styles.separator} />;

	renderItem = ({ item }) => {
		const name = item.search ? item.name : item.fname;
		const username = item.search ? item.username : item.name;
		return (
			<UserItem
				name={name}
				username={username}
				onPress={() => this._onPressItem(item._id, item)}
				testID={`select-users-view-item-${ item.name }`}
				icon={this.isChecked(username) ? 'check' : null}
			/>
		);
	}

	renderList = () => (
		<FlatList
			data={this.state.search.length > 0 ? this.state.search : this.data}
			extraData={this.props}
			keyExtractor={item => item._id}
			style={[styles.list]}
			renderItem={this.renderItem}
			ItemSeparatorComponent={this.renderSeparator}
			enableEmptySections
			keyboardShouldPersistTaps='always'
		/>
	)

	render = () => (
		<SafeAreaView style={styles.safeAreaView} testID='select-users-view'>
			<ScrollView keyboardShouldPersistTaps='always'>
				{this.renderHeader()}
				{this.renderList()}
			</ScrollView>
			<Loading visible={this.props.loading} />
		</SafeAreaView>
	)
}
